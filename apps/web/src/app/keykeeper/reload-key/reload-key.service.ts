import { Injectable } from "@angular/core";

import { LockService } from "@bitwarden/auth/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { VaultTimeoutSettingsService } from "@bitwarden/common/key-management/vault-timeout";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { KeyService } from "@bitwarden/key-management";

import { browserPage, KeykeeperReloadKey } from "./reload-key";

/**
 * Keykeeper: a web vault tab stays unlocked across a reload (reload-key.ts),
 * with the web vault's services. InitService restores at startup, then starts it.
 */
@Injectable({ providedIn: "root" })
export class KeykeeperReloadKeyService extends KeykeeperReloadKey {
  constructor(
    api: ApiService,
    accountService: AccountService,
    keyService: KeyService,
    encryptService: EncryptService,
    stateProvider: StateProvider,
    tokenService: TokenService,
    vaultTimeoutSettingsService: VaultTimeoutSettingsService,
    policyService: PolicyService,
    environmentService: EnvironmentService,
    logService: LogService,
    lockService: LockService,
  ) {
    super({
      api,
      accountService,
      keyService,
      encryptService,
      stateProvider,
      tokenService,
      vaultTimeoutSettingsService,
      policyService,
      environmentService,
      logService,
      registerOnLockAction: (action) => lockService.registerOnLockAction(action),
      lock: (userId) => lockService.lock(userId),
      ...browserPage,
    });
  }
}
