import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom, of } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { Policy } from "@bitwarden/common/admin-console/models/domain/policy";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { CryptoFunctionService } from "@bitwarden/common/key-management/crypto/abstractions/crypto-function.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncryptServiceImplementation } from "@bitwarden/common/key-management/crypto/services/encrypt.service.implementation";
import { MaximumSessionTimeoutPolicyData } from "@bitwarden/common/key-management/session-timeout";
import {
  VaultTimeout,
  VaultTimeoutAction,
  VaultTimeoutSettingsService,
  VaultTimeoutStringType,
} from "@bitwarden/common/key-management/vault-timeout";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SdkLoadService } from "@bitwarden/common/platform/abstractions/sdk/sdk-load.service";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { FakeAccountService, FakeStateProvider } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import {
  KeykeeperReloadKey,
  RELOAD_KEY,
  reloadWait,
  STAY_UNLOCKED_ON_RELOAD,
  unwrapAfterReload,
  wrapForReload,
} from "./reload-key";
import * as vectors from "./reload-key-v1.json";

/** Loads upstream's SDK the way the web vault does, so its crypto runs here. */
class TestSdkLoadService extends SdkLoadService {
  protected async load(): Promise<void> {}
}

/** jsdom has no fetch Request; the parts the forget request uses. */
class TestRequest {
  readonly method: string;
  readonly keepalive: boolean;
  readonly headers: Headers;
  private readonly body: string;
  constructor(
    readonly url: string,
    init: { method: string; keepalive: boolean; headers: Record<string, string>; body: string },
  ) {
    this.method = init.method;
    this.keepalive = init.keepalive;
    this.headers = new Headers(init.headers);
    this.body = init.body;
  }
  async text() {
    return this.body;
  }
}
(globalThis as any).Request ??= TestRequest;

const USER = "user-1" as UserId;
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

let encryptService: EncryptService;

beforeAll(async () => {
  await new TestSdkLoadService().loadAndInit();
  await SdkLoadService.Ready;
  encryptService = new EncryptServiceImplementation(
    mock<CryptoFunctionService>(),
    mock<LogService>(),
    false,
  );
});

describe("the reload key wrap, version 1, against the vectors", () => {
  const wrappingKey = () => new SymmetricCryptoKey(bytes(vectors.wrap.wrappingKey));

  it("opens the wrapped user key with R, through upstream's EncryptService", async () => {
    const userKey = await unwrapAfterReload(
      encryptService,
      vectors.wrap.wrappedUserKey,
      wrappingKey(),
    );
    expect(Buffer.from(userKey.toEncoded()).toString("base64")).toBe(vectors.wrap.userKey);
  });

  it("wraps as an EncString of type 2 that opens back to the same key", async () => {
    const userKey = new SymmetricCryptoKey(bytes(vectors.wrap.userKey)) as UserKey;
    const wrapped = await wrapForReload(encryptService, userKey, wrappingKey());
    expect(wrapped).toMatch(/^2\.[^|]+\|[^|]+\|[^|]+$/);
    expect(wrapped).not.toBe(vectors.wrap.wrappedUserKey);
    const opened = await unwrapAfterReload(encryptService, wrapped, wrappingKey());
    expect(Buffer.from(opened.toEncoded()).toString("base64")).toBe(vectors.wrap.userKey);
  });

  it("refuses another tab's R, a changed MAC, and a changed ciphertext", async () => {
    const other = new SymmetricCryptoKey(bytes(vectors.refused.otherWrappingKey));
    await expect(
      unwrapAfterReload(encryptService, vectors.wrap.wrappedUserKey, other),
    ).rejects.toThrow();
    await expect(
      unwrapAfterReload(encryptService, vectors.refused.badMac, wrappingKey()),
    ).rejects.toThrow();
    await expect(
      unwrapAfterReload(encryptService, vectors.refused.badCiphertext, wrappingKey()),
    ).rejects.toThrow();
  });
});

describe("reloadWait", () => {
  const lock = VaultTimeoutAction.Lock;
  const policy = (type: MaximumSessionTimeoutPolicyData["type"]) =>
    ({ type, minutes: 15 }) as MaximumSessionTimeoutPolicyData;

  it("is the timeout in minutes, locking", () => {
    expect(reloadWait(15, lock, null)).toBe(15);
    expect(reloadWait(1, lock, policy("custom"))).toBe(1);
    expect(reloadWait(240, lock, policy("never"))).toBe(240);
  });

  it("keeps upstream's behavior otherwise", () => {
    expect(reloadWait(VaultTimeoutStringType.OnRestart, lock, null)).toBeNull();
    expect(reloadWait(VaultTimeoutStringType.Never, lock, null)).toBeNull();
    expect(reloadWait(0, lock, null)).toBeNull();
    expect(reloadWait(15, VaultTimeoutAction.LogOut, null)).toBeNull();
    expect(reloadWait(15, null, null)).toBeNull();
    expect(reloadWait(1, lock, policy("immediately"))).toBeNull();
    expect(reloadWait(15, lock, policy("onAppRestart"))).toBeNull();
    expect(reloadWait(15, lock, { type: "custom", minutes: 30, webReload: false })).toBeNull();
    expect(reloadWait(15, lock, null, false)).toBeNull();
    expect(reloadWait(15, lock, { type: "custom", minutes: 30, webReload: true }, true)).toBe(15);
  });
});

describe("KeykeeperReloadKey", () => {
  let accountService: FakeAccountService;
  let stateProvider: FakeStateProvider;
  let userKey$: BehaviorSubject<UserKey | null>;
  let timeout$: BehaviorSubject<VaultTimeout>;
  let action$: BehaviorSubject<VaultTimeoutAction>;
  let policies$: BehaviorSubject<Policy[]>;
  let api: ReturnType<typeof mock<ApiService>>;
  let keyService: ReturnType<typeof mock<KeyService>>;
  let lockActions: Array<(userId: UserId) => Promise<void>>;
  let server: Map<string, string>;
  let forgotten: string[];
  let navigation: string;
  let page: { leave: () => void; back: () => void };
  let beacons: Array<{ url: string; json: string }>;
  let locked: UserId[];
  let forgetFails: number;
  let reloadKey: KeykeeperReloadKey;

  const userKey = new SymmetricCryptoKey(bytes(vectors.wrap.userKey)) as UserKey;
  const record = () => firstValueFrom(stateProvider.getUser(USER, RELOAD_KEY).state$);
  const posts = (path: string) => api.send.mock.calls.filter((c) => c[1] === path);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    jest.useRealTimers();
    accountService = new FakeAccountService({
      [USER]: { email: "a@example.test", emailVerified: true, name: "a", creationDate: undefined },
    } as any);
    accountService.activeAccountSubject.next({ id: USER } as any);
    accountService.accountActivitySubject.next({ [USER]: new Date() } as Record<UserId, Date>);
    stateProvider = new FakeStateProvider(accountService);
    userKey$ = new BehaviorSubject<UserKey | null>(null);
    timeout$ = new BehaviorSubject<VaultTimeout>(15);
    action$ = new BehaviorSubject<VaultTimeoutAction>(VaultTimeoutAction.Lock);
    policies$ = new BehaviorSubject<Policy[]>([]);
    server = new Map();
    forgotten = [];
    lockActions = [];
    navigation = "reload";
    beacons = [];
    locked = [];
    forgetFails = 0;

    keyService = mock<KeyService>();
    keyService.userKey$.mockReturnValue(userKey$);
    keyService.setUserKey.mockImplementation(async (key) => userKey$.next(key as UserKey));

    // A server that keeps R by tab, and forgets it on request.
    api = mock<ApiService>();
    api.send.mockImplementation(async (_method, path, body: any) => {
      switch (path) {
        case "/keykeeper/reload-key":
          server.set(body.tabId, body.key);
          return null;
        case "/keykeeper/reload-key/release":
          if (!server.has(body.tabId)) {
            throw new ErrorResponse({ message: "Not found" }, 404);
          }
          return { key: server.get(body.tabId) };
        case "/keykeeper/reload-key/check-in":
          if (!server.has(body.tabId)) {
            throw new ErrorResponse({ message: "Not found" }, 404);
          }
          return null;
      }
      throw new Error(`unexpected ${path}`);
    });
    api.fetch.mockImplementation(async (request: Request) => {
      if (forgetFails > 0) {
        forgetFails--;
        return { ok: false, status: 503 } as Response;
      }
      const { tabId } = JSON.parse(await request.text());
      forgotten.push(tabId);
      server.delete(tabId);
      return { ok: true, status: 200 } as Response;
    });
    api.getActiveBearerToken.mockResolvedValue("access-token");

    const tokenService = mock<TokenService>();
    tokenService.getAccessToken.mockResolvedValue("access-token");
    const environmentService = mock<EnvironmentService>();
    (environmentService as any).environment$ = of({
      getApiUrl: () => "https://vault.example.test/api",
    });
    const settings = mock<VaultTimeoutSettingsService>();
    settings.getVaultTimeoutByUserId$.mockReturnValue(timeout$);
    settings.getVaultTimeoutActionByUserId$.mockReturnValue(action$);
    const policyService = mock<PolicyService>();
    policyService.policiesByType$.mockImplementation((type) =>
      type === PolicyType.MaximumVaultTimeout ? policies$ : of([]),
    );

    reloadKey = new KeykeeperReloadKey({
      api,
      accountService,
      keyService,
      encryptService,
      stateProvider,
      tokenService,
      vaultTimeoutSettingsService: settings,
      policyService,
      environmentService,
      logService: mock<LogService>(),
      registerOnLockAction: (action) => lockActions.push(action),
      lock: async (userId) => {
        locked.push(userId);
      },
      navigationType: () => navigation,
      onPageLifecycle: (leave, back) => {
        page = { leave, back };
      },
      beacon: (url, json) => beacons.push({ url, json }),
    });
  });

  afterEach(() => reloadKey.stop());

  /** A real unlock: the key arrives in memory, not from a reload key. */
  async function unlock() {
    userKey$.next(userKey);
    await settle();
    await settle();
  }

  /** Upstream's lock: the key goes, then its lock actions run. */
  async function lock() {
    userKey$.next(null);
    await stateProvider.getUser(USER, RELOAD_KEY).update(() => null);
    for (const action of lockActions) {
      await action(USER);
    }
  }

  it("at a real unlock, keeps only the wrapped user key here and gives R to the server", async () => {
    reloadKey.start();
    await unlock();

    const [kept] = posts("/keykeeper/reload-key");
    const body = kept[2];
    expect(body.tabId).toMatch(/^[0-9a-f]{32}$/);
    expect(bytes(body.key)).toHaveLength(64);
    expect(body.timeoutMinutes).toBe(15);
    const saved = await record();
    expect(saved).toEqual({ tabId: body.tabId, wrappedUserKey: expect.stringMatching(/^2\./) });
    expect(JSON.stringify(saved)).not.toContain(body.key);
    expect(JSON.stringify(saved)).not.toContain(vectors.wrap.userKey);
    const opened = await unwrapAfterReload(
      encryptService,
      saved!.wrappedUserKey,
      new SymmetricCryptoKey(bytes(body.key)),
    );
    expect(opened.toEncoded()).toEqual(userKey.toEncoded());
  });

  it("after a reload, unlocks from the server's R, and makes no new one", async () => {
    reloadKey.start();
    await unlock();
    const tabId = (await record())!.tabId;
    reloadKey.stop();

    // The page reloads: memory is gone, sessionStorage stays.
    userKey$.next(null);
    api.send.mockClear();
    const reloaded = new KeykeeperReloadKey((reloadKey as any).deps);
    expect(await reloaded.restore(USER)).toBe(true);
    expect(keyService.setUserKey).toHaveBeenCalledWith(expect.anything(), USER);
    expect(userKey$.value!.toEncoded()).toEqual(userKey.toEncoded());
    expect(posts("/keykeeper/reload-key/release")[0][2]).toEqual({ tabId });

    reloaded.start();
    await settle();
    expect(posts("/keykeeper/reload-key")).toHaveLength(0);
    await reloaded.checkIn();
    expect(posts("/keykeeper/reload-key/check-in")[0][2]).toEqual({
      tabId,
      idleSeconds: expect.any(Number),
      timeoutMinutes: 15,
    });
    reloaded.stop();
  });

  it("asks for the master password once the server no longer has R", async () => {
    reloadKey.start();
    await unlock();
    reloadKey.stop();
    server.clear(); // the server restarted
    userKey$.next(null);

    expect(await reloadKey.restore(USER)).toBe(false);
    expect(keyService.setUserKey).not.toHaveBeenCalled();
    expect(await record()).toBeNull();
  });

  it("forgets it when the vault locks, before the page reloads", async () => {
    reloadKey.start();
    await unlock();
    const tabId = (await record())!.tabId;

    await lock();
    expect(forgotten).toContain(tabId);
    expect(server.has(tabId)).toBe(false);
    expect(await record()).toBeNull();
    const [request] = api.fetch.mock.calls[0];
    expect(request.url).toBe("https://vault.example.test/api/keykeeper/reload-key/forget");
    expect(request.keepalive).toBe(true);
    expect(request.headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("keeps none for On browser refresh, signing out, or a policy that locks on reload", async () => {
    for (const [timeout, action, type] of [
      [VaultTimeoutStringType.OnRestart, VaultTimeoutAction.Lock, null],
      [15, VaultTimeoutAction.LogOut, null],
      [1, VaultTimeoutAction.Lock, "immediately"],
      [15, VaultTimeoutAction.Lock, "onAppRestart"],
    ] as const) {
      timeout$.next(timeout);
      action$.next(action);
      policies$.next(
        type == null
          ? []
          : [{ type: PolicyType.MaximumVaultTimeout, enabled: true, data: { type } } as Policy],
      );
      reloadKey.start();
      await unlock();
      expect(posts("/keykeeper/reload-key")).toHaveLength(0);
      expect(await record()).toBeNull();
      reloadKey.stop();
      userKey$.next(null);
      await settle();
    }
  });

  it("forgets it at once when the timeout changes to On browser refresh", async () => {
    reloadKey.start();
    await unlock();
    const tabId = (await record())!.tabId;

    timeout$.next(VaultTimeoutStringType.OnRestart);
    await settle();
    await settle();
    expect(forgotten).toContain(tabId);
    expect(await record()).toBeNull();
  });

  it("doesn't restore when the tab hasn't been used for its timeout", async () => {
    reloadKey.start();
    await unlock();
    reloadKey.stop();
    userKey$.next(null);
    accountService.accountActivitySubject.next({
      [USER]: new Date(Date.now() - 16 * 60_000),
    } as Record<UserId, Date>);
    api.send.mockClear();

    expect(await reloadKey.restore(USER)).toBe(false);
    expect(posts("/keykeeper/reload-key/release")).toHaveLength(0);
    expect(await record()).toBeNull();
  });

  it("stops, without a new R, when a check-in finds it gone", async () => {
    reloadKey.start();
    await unlock();
    server.clear();
    api.send.mockClear();

    await reloadKey.checkIn();
    expect(await record()).toBeNull();
    await reloadKey.checkIn();
    expect(posts("/keykeeper/reload-key/check-in")).toHaveLength(1);
    expect(posts("/keykeeper/reload-key")).toHaveLength(0);
  });

  it("restores only on a reload: a reopened tab, Back, or a new load stays locked", async () => {
    for (const how of ["back_forward", "navigate", "prerender", undefined]) {
      reloadKey.start();
      await unlock();
      const tabId = (await record())!.tabId;
      reloadKey.stop();
      userKey$.next(null);
      api.send.mockClear();

      navigation = how as string;
      const reopened = new KeykeeperReloadKey((reloadKey as any).deps);
      expect(await reopened.restore(USER)).toBe(false);
      expect(posts("/keykeeper/reload-key/release")).toHaveLength(0);
      expect(keyService.setUserKey).not.toHaveBeenCalled();
      // This tab won't try again; the server ends the entry on its own.
      expect(await record()).toBeNull();
      expect(forgotten).not.toContain(tabId);
      navigation = "reload";
      reloadKey = new KeykeeperReloadKey((reloadKey as any).deps);
    }
  });

  it("tells the server as the page goes, with a beacon that carries only the tab id", async () => {
    reloadKey.start();
    await unlock();
    const tabId = (await record())!.tabId;

    page.leave();
    expect(beacons).toEqual([
      {
        url: "https://vault.example.test/api/keykeeper/reload-key/leaving",
        json: JSON.stringify({ tabId }),
      },
    ]);
  });

  it("locks a page that comes back from the back-forward cache unlocked", async () => {
    reloadKey.start();
    page.back();
    await settle();
    expect(locked).toEqual([]);

    await unlock();
    page.back();
    await settle();
    expect(locked).toEqual([USER]);
  });

  it("keeps none with Stay unlocked when I reload off, and forgets it when it's turned off", async () => {
    await stateProvider.getUser(USER, STAY_UNLOCKED_ON_RELOAD).update(() => false);
    reloadKey.start();
    await unlock();
    expect(posts("/keykeeper/reload-key")).toHaveLength(0);
    reloadKey.stop();
    userKey$.next(null);
    await settle();

    await reloadKey.setStayUnlocked(USER, true);
    reloadKey = new KeykeeperReloadKey((reloadKey as any).deps);
    reloadKey.start();
    await unlock();
    const tabId = (await record())!.tabId;
    await reloadKey.setStayUnlocked(USER, false);
    await settle();
    await settle();
    expect(forgotten).toContain(tabId);
    expect(await record()).toBeNull();
  });

  it("keeps none when the policy turns reload keys off", async () => {
    policies$.next([
      {
        type: PolicyType.MaximumVaultTimeout,
        enabled: true,
        data: { type: "custom", minutes: 30, webReload: false },
      } as Policy,
    ]);
    reloadKey.start();
    await unlock();
    expect(posts("/keykeeper/reload-key")).toHaveLength(0);
  });

  it("asks with a fresh token, and tries a forget that failed once more", async () => {
    reloadKey.start();
    await unlock();
    const tabId = (await record())!.tabId;

    forgetFails = 1;
    await reloadKey.forget(USER);
    expect(api.getActiveBearerToken).toHaveBeenCalledWith(USER);
    expect(forgotten).toEqual([]);
    expect(await record()).toBeNull();
    // The page's leaving says so too, meanwhile.
    page.leave();
    expect(beacons.map((b) => JSON.parse(b.json).tabId)).toEqual([tabId]);

    await (reloadKey as any).retryForget();
    expect(forgotten).toEqual([tabId]);
  });

  it("reports how long since the vault was last used", async () => {
    reloadKey.start();
    await unlock();
    accountService.accountActivitySubject.next({
      [USER]: new Date(Date.now() - 90_000),
    } as Record<UserId, Date>);
    await reloadKey.checkIn();
    const [checkIn] = posts("/keykeeper/reload-key/check-in");
    expect(checkIn[2].idleSeconds).toBeGreaterThanOrEqual(90);
    expect(checkIn[2].idleSeconds).toBeLessThan(95);
  });
});
