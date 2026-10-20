// Keykeeper: joining a client organization through the MSP's install command.
// The command gives the extension an enrollment token, and the server it
// belongs to, through browser policy. After the person unlocks an account on
// that server, the extension asks the server which organization the token
// belongs to, asks the person once whether to join it, and joins. When that
// organization enrolls members in account recovery, the person's user key is
// encrypted to the organization's public key first, exactly as upstream's
// enrollment does (PasswordResetEnrollmentServiceImplementation.enroll), and
// the prompt says what that lets its admins do. The join never includes the
// org key; the member waits to be confirmed. See DESIGN.md, "Onboarding
// through the RMM".

import { distinctUntilChanged, filter, firstValueFrom, map, of, switchMap } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { CryptoFunctionService } from "@bitwarden/common/key-management/crypto/abstractions/crypto-function.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { KeyService } from "@bitwarden/key-management";

import { BrowserApi } from "../platform/browser/browser-api";
import BrowserPopupUtils from "../platform/browser/browser-popup-utils";

import {
  JOIN_ANSWER_KEY,
  JOIN_REQUEST_KEY,
  JoinAnswer,
  JoinRequest,
  StoredJoinRequest,
} from "./join-request";

const STORAGE_KEY = "keykeeper.enrollment";
const NOTIFICATION_ID = "keykeeper-enrollment";
const ACCEPTED = 1;
/** After "Not now", ask again at an unlock a week later. */
const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The last outcome for each account, for the token it tried. Only a hash of
 * the token is kept: the token itself is a secret that lets anyone ask to join.
 */
export type EnrollmentState = Record<
  string,
  { tokenHash: string; result: "joined" | "declined" | { error: string }; at?: number }
>;

/** What the extension needs from the browser, so the logic can be tested without one. */
export interface EnrollmentPlatform {
  /** The enrollment token from browser policy, if any. */
  managedToken(): Promise<string | null>;
  /** The server browser policy points the extension to, which the token belongs to. */
  managedServer(): Promise<string | null>;
  load(): Promise<EnrollmentState>;
  save(state: EnrollmentState): Promise<void>;
  notify(title: string, message: string): Promise<void>;
  /** Asks the person whether to join: true to join, false or null (closed) for not now. */
  ask(request: JoinRequest, userId: UserId, tokenHash: string): Promise<boolean | null>;
  /**
   * Calls back when the person answers. The background can sleep while the
   * prompt is open, and then nothing is waiting for the answer anymore.
   */
  onAnswered(listener: () => void): void;
}

const managed = async (key: string): Promise<unknown> => {
  if (chrome.storage?.managed == null) {
    return null;
  }
  try {
    return (await chrome.storage.managed.get(key))[key] ?? null;
  } catch {
    // No policy store on this browser.
    return null;
  }
};

export const chromeEnrollmentPlatform: EnrollmentPlatform = {
  async managedToken() {
    const token = await managed("enrollmentToken");
    return typeof token === "string" && token.trim() !== "" ? token.trim() : null;
  },
  async managedServer() {
    const environment = (await managed("environment")) as { base?: unknown } | null;
    return typeof environment?.base === "string" && environment.base !== ""
      ? environment.base
      : null;
  },
  async load() {
    return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {};
  },
  async save(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  },
  async notify(title, message) {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("images/icon128.png"),
      title,
      message,
      priority: 1,
    });
  },
  onAnswered(listener) {
    BrowserApi.addListener(chrome.storage.onChanged, (changes, area) => {
      if (area === "session" && changes[JOIN_ANSWER_KEY]?.newValue != null) {
        listener();
      }
    });
  },
  async ask(request, userId, tokenHash) {
    const session = await chrome.storage.session.get([JOIN_REQUEST_KEY, JOIN_ANSWER_KEY]);
    const pending = session[JOIN_REQUEST_KEY] as StoredJoinRequest | undefined;
    const answered = session[JOIN_ANSWER_KEY] as JoinAnswer | undefined;
    // Answered while the background was asleep: use that answer.
    if (
      pending?.userId === userId &&
      pending.tokenHash === tokenHash &&
      answered?.id === pending.id
    ) {
      await chrome.storage.session.remove([JOIN_REQUEST_KEY, JOIN_ANSWER_KEY]);
      return answered.join === true;
    }
    const stored: StoredJoinRequest = { ...request, id: Utils.newGuid(), userId, tokenHash };
    await chrome.storage.session.remove(JOIN_ANSWER_KEY);
    await chrome.storage.session.set({ [JOIN_REQUEST_KEY]: stored });
    return new Promise<boolean | null>((resolve) => {
      let windowId: number | undefined;
      const finish = (answer: boolean | null) => {
        BrowserApi.removeListener(chrome.storage.onChanged, onChanged);
        BrowserApi.removeListener(chrome.windows.onRemoved, onRemoved);
        void chrome.storage.session.remove([JOIN_REQUEST_KEY, JOIN_ANSWER_KEY]);
        resolve(answer);
      };
      const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        const answer = changes[JOIN_ANSWER_KEY]?.newValue as JoinAnswer | undefined;
        if (area === "session" && answer?.id === stored.id) {
          finish(answer.join === true);
        }
      };
      const onRemoved = (closed: number) => {
        if (closed === windowId) {
          void chrome.storage.session.get(JOIN_ANSWER_KEY).then((s) => {
            const answer = s[JOIN_ANSWER_KEY] as JoinAnswer | undefined;
            finish(answer?.id === stored.id ? answer.join === true : null);
          });
        }
      };
      BrowserApi.addListener(chrome.storage.onChanged, onChanged);
      BrowserApi.addListener(chrome.windows.onRemoved, onRemoved);
      // A prompt left open from before shows an older question; replace it.
      BrowserPopupUtils.openPopout("popup/index.html#/keykeeper-join", {
        singleActionKey: "keykeeper-join",
        forceCloseExistingWindows: true,
      })
        .then((opened: chrome.windows.Window | undefined) => (windowId = opened?.id))
        .catch(() => finish(null));
    });
  },
};

type EnrollmentInfo = {
  organizationId: string;
  organizationName: string;
  publicKey: string | null;
  accountRecovery: boolean;
};

export type EnrollmentOutcome =
  "no-token" | "other-server" | "msp-staff" | "already-done" | "declined" | "joined" | "failed";

/** The origin of an address, or null when it isn't one. */
function originOf(url: string | null | undefined): string | null {
  try {
    const parsed = new URL(url ?? "");
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export class KeykeeperEnrollment {
  /** The run in progress for each account, so an unlock and a late answer can't both join. */
  private readonly running = new Map<UserId, Promise<EnrollmentOutcome>>();

  constructor(
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly apiService: ApiService,
    private readonly keyService: KeyService,
    private readonly encryptService: EncryptService,
    private readonly syncService: SyncService,
    private readonly environmentService: EnvironmentService,
    private readonly organizationService: OrganizationService,
    private readonly cryptoFunctionService: CryptoFunctionService,
    private readonly platform: EnrollmentPlatform = chromeEnrollmentPlatform,
  ) {}

  /** Tries to join whenever an account is unlocked, and when the person answers the prompt. */
  init() {
    this.platform.onAnswered(() => {
      void (async () => {
        const userId = await firstValueFrom(
          this.accountService.activeAccount$.pipe(getOptionalUserId),
        );
        if (
          userId != null &&
          (await firstValueFrom(this.authService.authStatusFor$(userId))) ===
            AuthenticationStatus.Unlocked
        ) {
          await this.run(userId);
        }
      })();
    });
    this.accountService.activeAccount$
      .pipe(
        getOptionalUserId,
        switchMap((userId) =>
          userId == null
            ? of(null)
            : this.authService
                .authStatusFor$(userId)
                .pipe(map((status) => (status === AuthenticationStatus.Unlocked ? userId : null))),
        ),
        distinctUntilChanged(),
        filter((userId): userId is UserId => userId != null),
      )
      .subscribe((userId) => void this.run(userId));
  }

  /**
   * Asks to join the organization the managed token belongs to, once per
   * account and token, and joins if the person says so.
   */
  run(userId: UserId): Promise<EnrollmentOutcome> {
    const running = this.running.get(userId);
    if (running != null) {
      return running;
    }
    const run = this.runOnce(userId).finally(() => this.running.delete(userId));
    this.running.set(userId, run);
    return run;
  }

  private async runOnce(userId: UserId): Promise<EnrollmentOutcome> {
    const token = await this.platform.managedToken();
    if (token == null) {
      return "no-token";
    }
    // The token goes only to the server the same policy names: never to
    // another account's server.
    const environment = await firstValueFrom(this.environmentService.getEnvironment$(userId));
    const server = originOf(await this.platform.managedServer());
    if (server == null || server !== originOf(environment?.getWebVaultUrl())) {
      return "other-server";
    }
    // The token's SHA-256, to remember it by without keeping it.
    const tokenHash = Utils.fromBufferToHex(
      (await this.cryptoFunctionService.hash(token, "sha256")).buffer,
    );
    const state = await this.platform.load();
    const previous = state[userId];
    if (previous?.tokenHash === tokenHash) {
      if (previous.result === "joined") {
        return "already-done";
      }
      if (previous.result === "declined" && Date.now() - (previous.at ?? 0) < ASK_AGAIN_MS) {
        return "declined";
      }
    }

    try {
      // MSP staff sign in on clients' computers; they never join a client this way.
      const msps: { data: unknown[] } = await this.apiService.send(
        "GET",
        "/keykeeper/msp",
        null,
        true,
        true,
      );
      if (msps.data.length > 0) {
        return "msp-staff";
      }
      const info: EnrollmentInfo = await this.apiService.send(
        "POST",
        "/keykeeper/enrollment/info",
        { token },
        true,
        true,
      );
      const organizations = await firstValueFrom(this.organizationService.organizations$(userId));
      if (organizations.some((o) => o.id === info.organizationId)) {
        state[userId] = { tokenHash, result: "joined" };
        await this.platform.save(state);
        return "already-done";
      }
      const answer = await this.platform.ask(
        {
          organizationName: info.organizationName,
          accountRecovery: info.accountRecovery,
          fingerprint: info.publicKey
            ? await this.keyService.getFingerprint(
                info.organizationId,
                Utils.fromB64ToArray(info.publicKey),
              )
            : null,
          adminElsewhere: organizations.filter((o) => o.isOwner || o.isAdmin).map((o) => o.name),
        },
        userId,
        tokenHash,
      );
      if (answer !== true) {
        state[userId] = { tokenHash, result: "declined", at: Date.now() };
        await this.platform.save(state);
        return "declined";
      }
      const resetPasswordKey = info.accountRecovery
        ? await this.recoveryKey(userId, info.publicKey)
        : undefined;
      const joined: { status: number } = await this.apiService.send(
        "POST",
        "/keykeeper/enrollment/join",
        { token, resetPasswordKey },
        true,
        true,
      );
      state[userId] = { tokenHash, result: "joined" };
      await this.platform.save(state);
      if (joined.status === ACCEPTED) {
        await this.platform.notify(
          `You joined ${info.organizationName}`,
          "An admin will confirm you shortly.",
        );
      }
      await this.syncService.fullSync(true);
      return "joined";
    } catch (e) {
      const error = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      // Tell the person once per problem, not at every unlock.
      const sameAsBefore =
        previous?.tokenHash === tokenHash &&
        typeof previous.result === "object" &&
        previous.result.error === error;
      if (!sameAsBefore) {
        await this.platform.notify("Couldn't join your organization", error);
      }
      state[userId] = { tokenHash, result: { error } };
      await this.platform.save(state);
      return "failed";
    }
  }

  /** The user key encrypted to the organization's public key, as upstream's enrollment does. */
  private async recoveryKey(userId: UserId, publicKey: string | null): Promise<string> {
    if (!publicKey) {
      throw new Error("The organization has no public key for account recovery.");
    }
    const userKey = await firstValueFrom(this.keyService.userKey$(userId));
    if (userKey == null) {
      throw new Error("Unlock to join your organization.");
    }
    const encrypted = await this.encryptService.encapsulateKeyUnsigned(
      userKey,
      Utils.fromB64ToArray(publicKey),
    );
    return encrypted.encryptedString;
  }
}
