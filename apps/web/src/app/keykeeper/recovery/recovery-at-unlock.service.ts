import { Injectable } from "@angular/core";

import { KeykeeperRecoveryAtUnlock } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { PasswordResetEnrollmentServiceAbstraction } from "@bitwarden/common/auth/abstractions/password-reset-enrollment.service.abstraction";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { KeyService } from "@bitwarden/key-management";

/**
 * Keykeeper: enrolling people in account recovery at unlock, where their
 * organization turned it on after they joined (KeykeeperRecoveryAtUnlock),
 * with the web vault's services. Started by InitService. The browser
 * extension runs the same.
 */
@Injectable({ providedIn: "root" })
export class KeykeeperRecoveryAtUnlockService extends KeykeeperRecoveryAtUnlock {
  constructor(
    accountService: AccountService,
    authService: AuthService,
    organizationService: OrganizationService,
    policyService: PolicyService,
    syncService: SyncService,
    keyService: KeyService,
    enrollment: PasswordResetEnrollmentServiceAbstraction,
    stateProvider: StateProvider,
    logService: LogService,
  ) {
    super(
      accountService,
      authService,
      organizationService,
      policyService,
      syncService,
      keyService,
      enrollment,
      stateProvider,
      logService,
    );
  }
}
