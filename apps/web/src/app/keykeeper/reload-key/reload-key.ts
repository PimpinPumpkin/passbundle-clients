// Keykeeper: a web vault tab stays unlocked across a reload.
//
// Upstream's web vault keeps the user key only in the page's memory, so every
// reload locks it. At a real unlock (signing in, the master password, any way
// but this one), the tab makes a random key R, wraps the user key with it
// using upstream's own key wrap (an EncString), keeps only the wrapped user
// key and a random tab id in its own sessionStorage, and gives R and the tab
// id to the server over the signed-in session. The server keeps R in memory
// only. After a reload, the tab asks for R back with its tab id, unwraps the
// user key, and puts it in memory as upstream does for a "never" timeout.
//
// - Only for a timeout in minutes with the Lock action: "On browser refresh"
//   and Log out keep upstream's behavior, and so do "immediately" and "on app
//   restart" policies. A "when the computer locks" policy caps the minutes
//   (keykeeper-system-lock.ts).
// - The tab checks in every 30 seconds while unlocked, saying how long since
//   it was last used. The server ends the entry when the tab hasn't been used
//   for its timeout, or hasn't checked in for 2 minutes (the browser closed).
// - Locking, signing out, or changing the timeout to one this doesn't cover
//   forgets it at once, here and on the server.
// - A key restored this way never makes a new R; the next real unlock does.
//
// See DESIGN.md, "Staying unlocked across a reload", in the meta repo.
import {
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  Subscription,
  switchMap,
} from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { getFirstPolicy } from "@bitwarden/common/admin-console/services/policy/default-policy.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { MaximumSessionTimeoutPolicyData } from "@bitwarden/common/key-management/session-timeout";
import {
  VaultTimeout,
  VaultTimeoutAction,
  VaultTimeoutSettingsService,
} from "@bitwarden/common/key-management/vault-timeout";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SdkLoadService } from "@bitwarden/common/platform/abstractions/sdk/sdk-load.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
import { PureCrypto } from "@bitwarden/sdk-internal";
import { KEYKEEPER_RELOAD_KEY_DISK, StateProvider, UserKeyDefinition } from "@bitwarden/state";

/** What a tab keeps in its own sessionStorage: never R, never the user key in the clear. */
export type ReloadKeyRecord = { tabId: string; wrappedUserKey: string };

/** Cleared by upstream's own lock and logout, before a lock reloads the page. */
export const RELOAD_KEY = new UserKeyDefinition<ReloadKeyRecord>(
  KEYKEEPER_RELOAD_KEY_DISK,
  "reloadKey",
  {
    deserializer: (record) => record,
    clearOn: ["lock", "logout"],
  },
);

/** How often an unlocked tab checks in. Browsers run a hidden tab's timers at
 * most once a minute, inside the server's 2 minutes. */
export const CHECK_IN_MS = 30_000;
/** How long to wait for the server on a reload before showing the lock screen. */
const RELEASE_TIMEOUT_MS = 10_000;
/** How long locking waits for the server to forget, before going on anyway. */
const FORGET_TIMEOUT_MS = 2_000;

/**
 * The wait a reload key may have, in minutes, or null when a reload must lock
 * as upstream's does: a timeout that isn't minutes ("On browser refresh",
 * "Never"), signing out instead of locking, or a policy that says a reload
 * locks ("immediately", "on app restart").
 */
export function reloadWait(
  timeout: VaultTimeout | null,
  action: VaultTimeoutAction | null,
  policy: MaximumSessionTimeoutPolicyData | null,
): number | null {
  if (action !== VaultTimeoutAction.Lock) {
    return null;
  }
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1) {
    return null;
  }
  if (policy?.type === "immediately" || policy?.type === "onAppRestart") {
    return null;
  }
  return timeout;
}

/** The user key, wrapped with R by upstream's key wrap. */
export async function wrapForReload(
  encryptService: EncryptService,
  userKey: UserKey,
  wrappingKey: SymmetricCryptoKey,
): Promise<string> {
  return (await encryptService.wrapSymmetricKey(userKey, wrappingKey)).encryptedString;
}

/** The user key, from its wrap and R. Throws when R isn't the one it was wrapped with. */
export async function unwrapAfterReload(
  encryptService: EncryptService,
  wrappedUserKey: string,
  wrappingKey: SymmetricCryptoKey,
): Promise<UserKey> {
  return (await encryptService.unwrapSymmetricKey(
    new EncString(wrappedUserKey),
    wrappingKey,
  )) as UserKey;
}

/** A new R: an AES-256-CBC key with its HMAC key, as upstream makes keys. */
export async function newWrappingKey(): Promise<SymmetricCryptoKey> {
  await SdkLoadService.Ready;
  return SymmetricCryptoKey.fromSdk(PureCrypto.make_aes256_cbc_hmac_key());
}

/** A new tab id: 16 random bytes in lowercase hex. */
export function newTabId(): string {
  return Utils.fromBufferToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The pieces of the web vault this uses; the services themselves in the app. */
export type ReloadKeyDeps = {
  api: ApiService;
  accountService: AccountService;
  keyService: KeyService;
  encryptService: EncryptService;
  stateProvider: StateProvider;
  tokenService: TokenService;
  vaultTimeoutSettingsService: VaultTimeoutSettingsService;
  policyService: PolicyService;
  environmentService: EnvironmentService;
  logService: LogService;
  /** Upstream's lock: runs this before it reloads the page. */
  registerOnLockAction: (action: (userId: UserId) => Promise<void>) => void;
};

export class KeykeeperReloadKey {
  /** The tab whose R the server keeps, while it does. */
  private tab: { userId: UserId; tabId: string } | null = null;
  private checkIns: ReturnType<typeof setInterval> | null = null;
  private subscriptions: Subscription[] = [];
  /** The last forget, which upstream's lock waits for before it reloads the page. */
  private forgetting: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ReloadKeyDeps) {}

  /**
   * At startup, before anything reads the key: unlocks the account from this
   * tab's reload key, if the server still keeps its R. Whether it did.
   */
  async restore(userId: UserId): Promise<boolean> {
    const { keyService, encryptService, logService } = this.deps;
    const record = await this.record(userId);
    if (record == null) {
      return false;
    }
    if ((await firstValueFrom(keyService.userKey$(userId))) != null) {
      return false;
    }
    const wait = await this.wait(userId);
    if (wait == null || (await this.idleMs(userId)) >= wait * 60_000) {
      await this.drop(userId, record.tabId);
      return false;
    }

    try {
      const response = await withTimeout<{ key: string }>(
        this.deps.api.send(
          "POST",
          "/keykeeper/reload-key/release",
          { tabId: record.tabId },
          userId,
          true,
        ),
        RELEASE_TIMEOUT_MS,
      );
      const wrappingKey = new SymmetricCryptoKey(Utils.fromB64ToArray(response.key));
      const userKey = await unwrapAfterReload(encryptService, record.wrappedUserKey, wrappingKey);
      this.tab = { userId, tabId: record.tabId };
      await keyService.setUserKey(userKey, userId);
      return true;
    } catch {
      logService.info("[Keykeeper] This reload asks for the master password");
      this.tab = null;
      await this.drop(userId, record.tabId);
      return false;
    }
  }

  /** Keeps a reload key after each real unlock, checks in, and forgets it on lock. */
  start(): void {
    const { accountService, keyService, registerOnLockAction } = this.deps;
    registerOnLockAction((userId) => this.forget(userId));

    this.subscriptions.push(
      accountService.activeAccount$
        .pipe(
          switchMap((account) =>
            account == null
              ? of(null)
              : keyService
                  .userKey$(account.id)
                  .pipe(map((key) => ({ userId: account.id, unlocked: key != null }))),
          ),
          distinctUntilChanged((a, b) => a?.userId === b?.userId && a?.unlocked === b?.unlocked),
        )
        .subscribe((state) => void this.onKeyChange(state)),
    );

    // Changing the timeout to one this doesn't cover (On browser refresh,
    // Log out) forgets the reload key at once, so the next reload locks.
    this.subscriptions.push(
      accountService.activeAccount$
        .pipe(
          switchMap((account) =>
            account == null
              ? of(null)
              : combineLatest([
                  this.deps.vaultTimeoutSettingsService.getVaultTimeoutByUserId$(account.id),
                  this.deps.vaultTimeoutSettingsService.getVaultTimeoutActionByUserId$(account.id),
                  this.policy$(account.id),
                ]).pipe(map((settings) => ({ userId: account.id, wait: reloadWait(...settings) }))),
          ),
        )
        .subscribe((state) => {
          if (state != null && state.wait == null && this.tab?.userId === state.userId) {
            void this.forget(state.userId);
          }
        }),
    );
  }

  stop(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions = [];
    this.stopCheckIns();
  }

  private async onKeyChange(state: { userId: UserId; unlocked: boolean } | null) {
    if (state == null) {
      return;
    }
    if (!state.unlocked) {
      // Signing out, or locking (whose own action came first).
      await this.forget(state.userId);
      return;
    }
    if (this.tab?.userId === state.userId) {
      // Restored at startup: keep checking in with the same R.
      this.startCheckIns();
      return;
    }
    await this.keep(state.userId);
  }

  /** At a real unlock: a new R for this tab, if the timeout allows one. */
  private async keep(userId: UserId) {
    const { keyService, encryptService, stateProvider, logService } = this.deps;
    try {
      const wait = await this.wait(userId);
      const userKey = await firstValueFrom(keyService.userKey$(userId));
      if (wait == null || userKey == null) {
        await stateProvider.getUser(userId, RELOAD_KEY).update(() => null);
        return;
      }
      const wrappingKey = await newWrappingKey();
      const tabId = newTabId();
      const wrappedUserKey = await wrapForReload(encryptService, userKey, wrappingKey);
      // Known before the server has it, so a lock meanwhile forgets it there.
      this.tab = { userId, tabId };
      await this.deps.api.send(
        "POST",
        "/keykeeper/reload-key",
        { tabId, key: wrappingKey.toBase64(), timeoutMinutes: wait },
        userId,
        false,
      );
      if (!(await this.stillUnlocked(userId, tabId))) {
        return;
      }
      await stateProvider.getUser(userId, RELOAD_KEY).update(() => ({ tabId, wrappedUserKey }));
      // A lock while saving cleared the record first: clear it again.
      if (!(await this.stillUnlocked(userId, tabId))) {
        await stateProvider.getUser(userId, RELOAD_KEY).update(() => null);
        return;
      }
      this.startCheckIns();
    } catch {
      logService.info("[Keykeeper] This tab won't stay unlocked across a reload");
      if (this.tab?.userId === userId) {
        await this.forget(userId);
      }
    }
  }

  private async stillUnlocked(userId: UserId, tabId: string): Promise<boolean> {
    const unlocked = (await firstValueFrom(this.deps.keyService.userKey$(userId))) != null;
    if (!unlocked || this.tab?.tabId !== tabId) {
      if (this.tab?.tabId === tabId) {
        await this.forget(userId);
      } else {
        await this.drop(userId, tabId);
      }
      return false;
    }
    return true;
  }

  private startCheckIns() {
    if (this.checkIns == null) {
      this.checkIns = setInterval(() => void this.checkIn(), CHECK_IN_MS);
    }
  }

  private stopCheckIns() {
    if (this.checkIns != null) {
      clearInterval(this.checkIns);
      this.checkIns = null;
    }
  }

  /** Tells the server the tab is open and how long since it was used. */
  async checkIn(): Promise<void> {
    const tab = this.tab;
    if (tab == null) {
      this.stopCheckIns();
      return;
    }
    const wait = await this.wait(tab.userId);
    if (wait == null) {
      await this.forget(tab.userId);
      return;
    }
    try {
      await this.deps.api.send(
        "POST",
        "/keykeeper/reload-key/check-in",
        {
          tabId: tab.tabId,
          idleSeconds: Math.floor((await this.idleMs(tab.userId)) / 1000),
          timeoutMinutes: wait,
        },
        tab.userId,
        false,
      );
    } catch (e) {
      // Gone on the server (expired, or the server restarted): the next
      // reload asks for the master password. Nothing else gets a new one.
      if ((e as { statusCode?: number })?.statusCode === 404 && this.tab?.tabId === tab.tabId) {
        this.tab = null;
        this.stopCheckIns();
        await this.deps.stateProvider.getUser(tab.userId, RELOAD_KEY).update(() => null);
      }
    }
  }

  /** Forgets this tab's reload key, here and on the server. */
  async forget(userId: UserId): Promise<void> {
    const tab = this.tab;
    if (tab == null || tab.userId !== userId) {
      // Already forgetting (the key went before the lock's own action ran).
      await this.forgetting;
      return;
    }
    this.tab = null;
    this.stopCheckIns();
    this.forgetting = this.drop(userId, tab.tabId);
    await this.forgetting;
  }

  /**
   * Asks the server to forget R, first, while signing out hasn't cleared the
   * access token yet, and clears the record, without waiting long.
   */
  private async drop(userId: UserId, tabId: string) {
    const forgotten = withTimeout(this.sendForget(userId, tabId), FORGET_TIMEOUT_MS).catch(() => {
      // The server forgets it on its own when the tab stops checking in.
    });
    try {
      await this.deps.stateProvider.getUser(userId, RELOAD_KEY).update(() => null);
    } catch {
      // Signed out already: nothing kept.
    }
    await forgotten;
  }

  /**
   * The server forgets R. Sent with the access token as it is now, outside
   * upstream's request handling, since signing out clears the token right
   * after; `keepalive` lets it finish while a lock reloads the page.
   */
  private async sendForget(userId: UserId, tabId: string) {
    const token = await this.deps.tokenService.getAccessToken(userId);
    if (token == null) {
      return;
    }
    const env = await firstValueFrom(this.deps.environmentService.environment$);
    await this.deps.api.fetch(
      new Request(`${env.getApiUrl()}/keykeeper/reload-key/forget`, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tabId }),
      }),
    );
  }

  private async record(userId: UserId): Promise<ReloadKeyRecord | null> {
    return await firstValueFrom(this.deps.stateProvider.getUser(userId, RELOAD_KEY).state$);
  }

  private policy$(userId: UserId) {
    return this.deps.policyService.policiesByType$(PolicyType.MaximumVaultTimeout, userId).pipe(
      getFirstPolicy,
      map((policy) => (policy?.data ?? null) as MaximumSessionTimeoutPolicyData | null),
    );
  }

  private async wait(userId: UserId): Promise<number | null> {
    const settings = this.deps.vaultTimeoutSettingsService;
    return reloadWait(
      await firstValueFrom(settings.getVaultTimeoutByUserId$(userId)),
      await firstValueFrom(settings.getVaultTimeoutActionByUserId$(userId)),
      await firstValueFrom(this.policy$(userId)),
    );
  }

  /** How long since the person last used the vault, by upstream's own record. */
  private async idleMs(userId: UserId): Promise<number> {
    const activity = await firstValueFrom(this.deps.accountService.accountActivity$);
    const last = activity?.[userId];
    return last == null ? 0 : Math.max(0, Date.now() - new Date(last).getTime());
  }
}
