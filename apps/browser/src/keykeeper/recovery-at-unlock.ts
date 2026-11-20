// Keykeeper: enrolling people in account recovery at unlock, in the browser
// extension, only to the organization key the install command names. The
// extension's code doesn't come from the server, so unlike the web vault it
// can't take the organization's public key on the server's word: a hacked
// server can make up a confirmed membership for anyone (it knows their public
// key, so it can make an organization key, wrap it to them, and make the
// organization's key pair itself), and would get the user key of everyone
// who unlocks. So the extension enrolls only when the key the server serves
// hashes to the install command's `orgKeyFingerprint` (browser policy: the
// SHA-256 of the organization's public key, SPKI, base64url without padding,
// which an owner's or admin's browser made from the organization's private
// key). Any other key is refused and said in the log; without a fingerprint
// nothing is sent. The enrollment itself is upstream's
// (PasswordResetEnrollmentServiceImplementation), given a key source that
// checks the key it hands out, so the key checked is the key encrypted to.
// See DESIGN.md, "Enrolling at unlock".

import {
  KeykeeperJoinSeals,
  KeykeeperRecoveryAtUnlock,
  OrganizationUserApiService,
  RecoveryKeyPin,
  RecoveryKeyRefused,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { OrganizationKeysResponse } from "@bitwarden/common/admin-console/models/response/organization-keys.response";
import { OrganizationApiService } from "@bitwarden/common/admin-console/services/organization/organization-api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { PasswordResetEnrollmentServiceImplementation } from "@bitwarden/common/auth/services/password-reset-enrollment.service.implementation";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { StateProvider } from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService } from "@bitwarden/legacy-crypto";

/** Said in the log when the server's key for an organization isn't the pinned one. */
export const NOT_THE_PINNED_KEY =
  "The organization's key from the server isn't the one this browser's install command names, so the extension didn't enroll you in its account recovery.";

/**
 * Upstream's organization API, except that an organization's keys are handed
 * out only when its public key is the pinned one. Used only for enrolling at
 * unlock, so upstream's enrollment encrypts the user key to nothing else.
 */
export class KeykeeperPinnedOrganizationApiService extends OrganizationApiService {
  constructor(
    apiService: ApiService,
    syncService: SyncService,
    private readonly pin: RecoveryKeyPin,
    private readonly seals = new KeykeeperJoinSeals(),
  ) {
    super(apiService, syncService);
  }

  override async getKeys(id: string): Promise<OrganizationKeysResponse> {
    const pin = await this.pin.pin();
    if (pin == null) {
      throw new RecoveryKeyRefused(NOT_THE_PINNED_KEY);
    }
    const keys = await super.getKeys(id);
    const fingerprint =
      keys?.publicKey == null || keys.publicKey === ""
        ? null
        : await this.seals.fingerprint(Utils.fromB64ToArray(keys.publicKey));
    if (fingerprint !== pin) {
      throw new RecoveryKeyRefused(NOT_THE_PINNED_KEY);
    }
    return keys;
  }
}

/** Enrolling at unlock in the extension: KeykeeperRecoveryAtUnlock with the install command's pin. */
export function extensionRecoveryAtUnlock(services: {
  accountService: AccountService;
  authService: AuthService;
  organizationService: OrganizationService;
  policyService: PolicyService;
  syncService: SyncService;
  keyService: KeyService;
  encryptService: EncryptService;
  apiService: ApiService;
  organizationUserApiService: OrganizationUserApiService;
  i18nService: I18nService;
  stateProvider: StateProvider;
  logService: LogService;
  /** The install command's `orgKeyFingerprint`, from browser policy (KeykeeperEnrollment.recoveryPin). */
  pin: () => Promise<string | null>;
  seals?: KeykeeperJoinSeals;
  settleMs?: number;
}): KeykeeperRecoveryAtUnlock {
  const pin: RecoveryKeyPin = { pin: services.pin };
  const enrollment = new PasswordResetEnrollmentServiceImplementation(
    new KeykeeperPinnedOrganizationApiService(
      services.apiService,
      services.syncService,
      pin,
      services.seals,
    ),
    services.accountService,
    services.keyService,
    services.encryptService,
    services.organizationUserApiService,
    services.i18nService,
  );
  return new KeykeeperRecoveryAtUnlock(
    services.accountService,
    services.authService,
    services.organizationService,
    services.policyService,
    services.syncService,
    services.keyService,
    enrollment,
    services.stateProvider,
    services.logService,
    { pin, settleMs: services.settleMs },
  );
}
