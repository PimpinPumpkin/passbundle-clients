import { createHash, webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import {
  KEYKEEPER_RECOVERY_TRIED,
  KeykeeperJoinSeals,
  NO_RECOVERY_PIN,
  OrganizationUserApiService,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { OrganizationUserStatusType, PolicyType } from "@bitwarden/common/admin-console/enums";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { Policy } from "@bitwarden/common/admin-console/models/domain/policy";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { SyncService } from "@bitwarden/common/platform/sync";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString } from "@bitwarden/legacy-crypto";

import { extensionRecoveryAtUnlock, NOT_THE_PINNED_KEY } from "./recovery-at-unlock";

const USER = "user-1" as UserId;
const USER_KEY = { key: "the user key" } as unknown as UserKey;

/** Stand-in public keys (SPKI), as the server serves them: base64. */
const dentalKey = Utils.fromBufferToB64(new Uint8Array([1, 2, 3, 4]).buffer);
const lawKey = Utils.fromBufferToB64(new Uint8Array([5, 6, 7, 8]).buffer);
const swappedKey = Utils.fromBufferToB64(new Uint8Array([6, 6, 6, 6]).buffer);
/** The install command's fingerprint of a key: SHA-256 of the SPKI, base64url without padding. */
const fingerprintOf = (b64: string) =>
  createHash("sha256").update(Buffer.from(b64, "base64")).digest("base64url");

const membership = (id: string) =>
  ({
    id,
    name: `Org ${id}`,
    status: OrganizationUserStatusType.Confirmed,
    keykeeperFromMsp: false,
    resetPasswordEnrolled: false,
    usePolicies: true,
    useResetPassword: true,
    hasPublicAndPrivateKeys: true,
  }) as Organization;

const recoveryPolicy = (organizationId: string) =>
  ({
    organizationId,
    type: PolicyType.ResetPassword,
    enabled: true,
    data: { autoEnrollEnabled: true },
  }) as Policy;

/**
 * The extension's own wiring, upstream's enrollment included, over a
 * stand-in server that serves these public keys for these organizations.
 */
function setup(pin: string | null, served: Record<string, string>) {
  const accountService = mock<AccountService>();
  accountService.activeAccount$ = new BehaviorSubject({ id: USER }) as any;
  const authStatus = new BehaviorSubject(AuthenticationStatus.Unlocked);
  const authService = mock<AuthService>();
  authService.authStatusFor$.mockReturnValue(authStatus);
  const organizationService = mock<OrganizationService>();
  organizationService.organizations$.mockReturnValue(
    of(Object.keys(served).map((id) => membership(id))),
  );
  const policyService = mock<PolicyService>();
  policyService.policies$.mockReturnValue(of(Object.keys(served).map(recoveryPolicy)));
  const syncService = mock<SyncService>();
  syncService.fullSync.mockResolvedValue(true);
  syncService.syncInProgress = false;
  const keyService = mock<KeyService>();
  keyService.userKey$.mockReturnValue(of(USER_KEY));
  const encryptService = mock<EncryptService>();
  // Says which key it encrypted to, so a test can tell.
  encryptService.encapsulateKeyUnsigned.mockImplementation(
    async (_key, publicKey) =>
      ({ encryptedString: `4.to-${Utils.fromBufferToB64(publicKey)}` }) as EncString,
  );
  const apiService = mock<ApiService>();
  apiService.send.mockImplementation(async (method, path) => {
    const match = /^\/organizations\/([^/]+)\/keys$/.exec(path);
    if (method === "GET" && match != null && served[match[1]] != null) {
      return { object: "organizationPublicKey", publicKey: served[match[1]] };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const organizationUserApiService = mock<OrganizationUserApiService>();
  organizationUserApiService.putOrganizationUserResetPasswordEnrollment.mockResolvedValue(
    undefined,
  );
  const stateProvider = new FakeStateProvider(mockAccountServiceWith(USER));
  const logService = mock<LogService>();
  const recovery = extensionRecoveryAtUnlock({
    accountService,
    authService,
    organizationService,
    policyService,
    syncService,
    keyService,
    encryptService,
    apiService,
    organizationUserApiService,
    i18nService: mock<I18nService>(),
    stateProvider,
    logService,
    pin: async () => pin,
    seals: new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto),
    settleMs: 0,
  });
  const enrolledIn = () =>
    organizationUserApiService.putOrganizationUserResetPasswordEnrollment.mock.calls.map(
      ([organizationId, userId, request]) => [organizationId, userId, request.resetPasswordKey],
    );
  const keysFetched = () => apiService.send.mock.calls.map(([, path]) => path);
  const lockAndUnlock = async () => {
    authStatus.next(AuthenticationStatus.Locked);
    await stateProvider.setUserState(KEYKEEPER_RECOVERY_TRIED, null, USER);
    authStatus.next(AuthenticationStatus.Unlocked);
  };
  return {
    recovery,
    encryptService,
    logService,
    syncService,
    enrolledIn,
    keysFetched,
    lockAndUnlock,
  };
}

describe("enrolling in account recovery at unlock, in the extension", () => {
  it("enrolls where the server's key is the one the install command names, encrypting to exactly that key", async () => {
    const { recovery, encryptService, enrolledIn } = setup(fingerprintOf(dentalKey), {
      dental: dentalKey,
    });

    expect(await recovery.run(USER)).toEqual([{ organizationId: "dental", enrolled: true }]);
    expect(encryptService.encapsulateKeyUnsigned).toHaveBeenCalledTimes(1);
    expect(
      Utils.fromBufferToB64(encryptService.encapsulateKeyUnsigned.mock.calls[0][1] as Uint8Array),
    ).toBe(dentalKey);
    expect(enrolledIn()).toEqual([["dental", USER, `4.to-${dentalKey}`]]);
  });

  it("refuses a different key for the organization (a hacked server's), sends nothing, says so in the log, and doesn't try again this unlock", async () => {
    const { recovery, encryptService, logService, enrolledIn, keysFetched } = setup(
      fingerprintOf(dentalKey),
      { dental: swappedKey },
    );

    expect(await recovery.run(USER)).toEqual([
      { organizationId: "dental", enrolled: false, error: NOT_THE_PINNED_KEY },
    ]);
    expect(encryptService.encapsulateKeyUnsigned).not.toHaveBeenCalled();
    expect(enrolledIn()).toEqual([]);
    expect(logService.warning).toHaveBeenCalledWith(
      `Account recovery at unlock in Org dental (dental): ${NOT_THE_PINNED_KEY}`,
    );

    expect(await recovery.run(USER)).toEqual([]);
    expect(keysFetched()).toEqual(["/organizations/dental/keys"]);
  });

  it("refuses an organization whose key the install command doesn't name, and still enrolls in the one it does", async () => {
    const { recovery, enrolledIn, logService } = setup(fingerprintOf(dentalKey), {
      dental: dentalKey,
      law: lawKey,
    });

    expect(await recovery.run(USER)).toEqual([
      { organizationId: "dental", enrolled: true },
      { organizationId: "law", enrolled: false, error: NOT_THE_PINNED_KEY },
    ]);
    expect(enrolledIn()).toEqual([["dental", USER, `4.to-${dentalKey}`]]);
    expect(logService.warning).toHaveBeenCalledWith(expect.stringContaining("Org law (law)"));
  });

  it("sends nothing without an install command's fingerprint, not even a request for the key, and starts no sync", async () => {
    const { recovery, encryptService, logService, syncService, enrolledIn, keysFetched } = setup(
      null,
      { dental: dentalKey },
    );

    expect(await recovery.run(USER)).toEqual([
      { organizationId: "dental", enrolled: false, error: NO_RECOVERY_PIN },
    ]);
    expect(keysFetched()).toEqual([]);
    expect(encryptService.encapsulateKeyUnsigned).not.toHaveBeenCalled();
    expect(enrolledIn()).toEqual([]);
    expect(logService.info).toHaveBeenCalledWith(expect.stringContaining(NO_RECOVERY_PIN));
    expect(syncService.fullSync).not.toHaveBeenCalled();
  });

  it("checks again at the next unlock, and enrolls once the server serves the named key", async () => {
    let served = swappedKey;
    const { recovery, enrolledIn, lockAndUnlock } = setup(fingerprintOf(dentalKey), {
      get dental() {
        return served;
      },
    });

    await recovery.run(USER);
    expect(enrolledIn()).toEqual([]);

    served = dentalKey;
    await lockAndUnlock();
    expect(await recovery.run(USER)).toEqual([{ organizationId: "dental", enrolled: true }]);
    expect(enrolledIn()).toEqual([["dental", USER, `4.to-${dentalKey}`]]);
  });
});
