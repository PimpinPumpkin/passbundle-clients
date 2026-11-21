// Keykeeper: the command-line tool sometimes failed a login the server had
// just let in, right after a new-device check was approved: "Failed to
// decode access token: Access token not found." The server's answer carries
// the device's token (TwoFactorToken, DESIGN.md "New-device check"), which
// the login strategy keeps by the account's email, and it read that email
// back from the access token it had just saved. The tool keeps its state in a
// file behind a lock: a save tells the state it changed while still holding
// the lock, the state's cached value can only catch up once it gets the lock
// again, and meanwhile the login's next writes take it first. So the read
// back found the cached value from before the save: no token.
//
// This spec runs the real token service and state over a storage that
// behaves like that file, with the access token watched the way the tool
// watches it (its config service follows the account's auth status, which
// stays subscribed), and a login that waits for a new-device check.
import { mock, MockProxy } from "jest-mock-extended";
import { of, Subject, Subscription } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { IdentityDeviceVerificationResponse } from "@bitwarden/common/auth/models/response/identity-device-verification.response";
import {
  PasswordPreloginData,
  PasswordPreloginService,
} from "@bitwarden/common/auth/password-prelogin";
import { ACCOUNT_ACTIVE_ACCOUNT_ID } from "@bitwarden/common/auth/services/account.service";
import { TokenService } from "@bitwarden/common/auth/services/token.service";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { AccountCryptographicStateService } from "@bitwarden/common/key-management/account-cryptography/account-cryptographic-state.service";
import { FakeMasterPasswordService } from "@bitwarden/common/key-management/master-password/services/fake-master-password.service";
import {
  VaultTimeoutAction,
  VaultTimeoutSettingsService,
  VaultTimeoutStringType,
} from "@bitwarden/common/key-management/vault-timeout";
import { AppIdService } from "@bitwarden/common/platform/abstractions/app-id.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { FakeAccountService, mockAccountServiceWith } from "@bitwarden/common/spec";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { UserId } from "@bitwarden/common/types/guid";
import { KdfConfigService, KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, LegacyCompatKeyService, PBKDF2KdfConfig } from "@bitwarden/legacy-crypto";
import { StateEventRegistrarService } from "@bitwarden/state";
import {
  DefaultGlobalStateProvider,
  DefaultSingleUserStateProvider,
} from "@bitwarden/state-internal";
import {
  AbstractStorageService,
  ObservableStorageService,
  SerializedMemoryStorageService,
  StorageServiceProvider,
  StorageUpdate,
} from "@bitwarden/storage-core";
import { UnlockService } from "@bitwarden/unlock";

import { InternalUserDecryptionOptionsServiceAbstraction } from "../abstractions/user-decryption-options.service.abstraction";
import { PasswordLoginCredentials } from "../models";

import { email, identityTokenResponseFactory } from "./login.strategy.spec-util";
import { PasswordLoginStrategy } from "./password-login.strategy";

const userId = Utils.newGuid() as UserId;
const deviceToken = "THIS_DEVICES_TOKEN";

/** An access token as the server signs it, with the account's id and email. */
function accessTokenFor(sub: UserId, mail: string): string {
  const payload = { sub, email: mail, email_verified: true, name: "Ana", premium: false };
  return ["e30", Utils.fromUtf8ToUrlB64(JSON.stringify(payload)), "signature"].join(".");
}

/**
 * Like the command-line tool's storage (LowdbStorageService): a file where every read and
 * write takes the file's lock. A write tells listeners while it still holds the lock, lets
 * go of it without waiting, and whoever found it taken tries again 100 ms later
 * (proper-lockfile's first retry).
 */
class FileBehindALock implements AbstractStorageService, ObservableStorageService {
  private readonly values = new Map<string, unknown>();
  private readonly updates = new Subject<StorageUpdate>();
  private locked = false;
  readonly updates$ = this.updates.asObservable();

  get valuesRequireDeserialization(): boolean {
    return true;
  }

  get<T>(key: string): Promise<T> {
    return this.withLock(() => (this.values.get(key) ?? null) as T);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) != null;
  }

  save<T>(key: string, obj: T): Promise<void> {
    return this.withLock(() => {
      this.values.set(key, obj);
      this.updates.next({ key, updateType: "save" });
    });
  }

  remove(key: string): Promise<void> {
    return this.withLock(() => {
      this.values.delete(key);
      this.updates.next({ key, updateType: "remove" });
    });
  }

  private async withLock<T>(action: () => T): Promise<T> {
    while (this.locked) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.locked = true;
    try {
      return action();
    } finally {
      void Promise.resolve().then(() => (this.locked = false));
    }
  }
}

describe("Keykeeper: a login that gets the device's token on the command-line tool's storage", () => {
  let tokenService: TokenService;
  let apiService: MockProxy<ApiService>;
  let accountService: FakeAccountService;
  let strategy: PasswordLoginStrategy;
  let watching: Subscription;

  beforeEach(async () => {
    jest.useFakeTimers();

    const storage = new StorageServiceProvider(
      new FileBehindALock(),
      new SerializedMemoryStorageService(),
    );
    const logService = mock<LogService>();
    const globalStateProvider = new DefaultGlobalStateProvider(storage, logService);
    const singleUserStateProvider = new DefaultSingleUserStateProvider(
      storage,
      mock<StateEventRegistrarService>(),
      logService,
    );
    tokenService = new TokenService(
      singleUserStateProvider,
      globalStateProvider,
      false, // The command-line tool has no secure storage: the tokens are in its file.
      mock<AbstractStorageService>(),
      mock<EncryptService>(),
      logService,
      jest.fn(),
    );

    // The account is the active one, as switching to it at login makes it.
    accountService = mockAccountServiceWith(userId);
    await globalStateProvider.get(ACCOUNT_ACTIVE_ACCOUNT_ID).update(() => userId);
    // The tool's config service follows the active account's auth status, which keeps
    // watching its access token from then on.
    watching = tokenService.hasAccessToken$(userId).subscribe();

    apiService = mock<ApiService>();
    const vaultTimeoutSettingsService = mock<VaultTimeoutSettingsService>();
    vaultTimeoutSettingsService.getVaultTimeoutActionByUserId$.mockReturnValue(
      of(VaultTimeoutAction.Lock),
    );
    vaultTimeoutSettingsService.getVaultTimeoutByUserId$.mockReturnValue(
      of(VaultTimeoutStringType.Never),
    );
    const passwordPreloginService = mock<PasswordPreloginService>();
    passwordPreloginService.getPreloginData$.mockReturnValue(
      of(new PasswordPreloginData(PBKDF2KdfConfig.createDefault(), "prelogin-salt")),
    );
    const legacyCompatKeyService = mock<LegacyCompatKeyService>();
    legacyCompatKeyService.makeMasterKey.mockResolvedValue({} as any);
    legacyCompatKeyService.hashMasterKey.mockResolvedValue("MASTER_PASSWORD_HASH");
    const appIdService = mock<AppIdService>();
    appIdService.getAppId.mockResolvedValue(Utils.newGuid());

    strategy = new PasswordLoginStrategy(
      undefined,
      mock<PasswordStrengthServiceAbstraction>(),
      mock<PolicyService>(),
      passwordPreloginService,
      mock<UnlockService>(),
      legacyCompatKeyService,
      accountService as unknown as AccountService,
      new FakeMasterPasswordService(),
      mock<KeyService>(),
      mock<EncryptService>(),
      apiService,
      tokenService,
      appIdService,
      mock<PlatformUtilsService>(),
      mock<MessagingService>(),
      logService,
      mock<TwoFactorService>(),
      mock<InternalUserDecryptionOptionsServiceAbstraction>(),
      mock<BillingAccountProfileStateService>(),
      vaultTimeoutSettingsService,
      mock<KdfConfigService>(),
      mock<EnvironmentService>(),
      mock<ConfigService>(),
      mock<AccountCryptographicStateService>(),
    );
  });

  afterEach(() => {
    watching.unsubscribe();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("logs in once the new-device check is approved, and keeps the device's token for the account's email", async () => {
    apiService.postIdentityToken.mockResolvedValueOnce(
      new IdentityDeviceVerificationResponse({
        error: "invalid_grant",
        error_description: "new device verification required",
        KeykeeperNewDeviceCheck: {
          id: "check-1",
          token: "CHECK_TOKEN",
          number: "47",
          status: "waiting",
          expiresAt: "2026-11-18T12:10:00Z",
          approvers: true,
          email: "never",
        },
      }),
    );
    const waiting = await strategy.logIn(new PasswordLoginCredentials(email, "password"));
    expect(waiting.requiresDeviceVerification).toBe(true);

    // Approved on another device: the login is sent again with the check's token, and the
    // server lets it in, with this device's own token for next time.
    const approved = identityTokenResponseFactory();
    approved.accessToken = accessTokenFor(userId, email);
    approved.twoFactorToken = deviceToken;
    apiService.postIdentityToken.mockResolvedValueOnce(approved);

    const result = await strategy.logInNewDeviceVerification("CHECK_TOKEN");

    expect(result.userId).toBe(userId);

    // The cached state catches up once it gets the file's lock.
    await jest.advanceTimersByTimeAsync(100);
    await expect(tokenService.getAccessToken(userId)).resolves.toBe(approved.accessToken);
    await expect(tokenService.getTwoFactorToken(email)).resolves.toBe(deviceToken);
  });
});
