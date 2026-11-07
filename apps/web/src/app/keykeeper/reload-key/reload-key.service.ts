import { Injectable } from "@angular/core";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { VaultTimeoutSettingsService } from "@bitwarden/common/key-management/vault-timeout";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService } from "@bitwarden/legacy-crypto";
import { LockService, LockSource, UnlockService } from "@bitwarden/unlock";

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
    unlockService: UnlockService,
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
      // Not the person's own lock: the page came back from the back-forward
      // cache, which locks the way a lapsed timeout does.
      lock: (userId) => lockService.lock(userId, LockSource.VaultTimeout),
      unlockWithUserKey: (userId, userKey) =>
        unlockService.unlockWithDecryptedUserKey(userId, userKey),
      ...browserPage,
    });
  }
}
