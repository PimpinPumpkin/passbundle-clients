import { Injectable } from "@angular/core";

import {
  CollectionAdminService,
  CollectionService,
  KeykeeperJoinChecks,
  KeykeeperMspWork,
  KeykeeperScriptCopies,
  KeykeeperScriptRefresher,
  KeykeeperTemplateSender,
  OrganizationUserService,
} from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { ToastService } from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperMspApiService } from "./msp-api.service";

/** Keykeeper: the shared template sender, with the web vault's services. */
@Injectable({ providedIn: "root" })
export class KeykeeperTemplateSenderService extends KeykeeperTemplateSender {
  constructor(
    mspApi: KeykeeperMspApiService,
    cipherService: CipherService,
    collectionAdminService: CollectionAdminService,
    accountService: AccountService,
    syncService: SyncService,
  ) {
    super(mspApi, cipherService, collectionAdminService, accountService, syncService);
  }
}

/** Keykeeper: who the web vault lets in on its own, with the web vault's services. */
@Injectable({ providedIn: "root" })
export class KeykeeperJoinChecksService extends KeykeeperJoinChecks {
  constructor(
    keyService: KeyService,
    encryptService: EncryptService,
    stateProvider: StateProvider,
  ) {
    super(keyService, encryptService, stateProvider);
  }
}

/**
 * Keykeeper: an MSP's background work in the web vault (confirming members
 * waiting for their org key, keeping clients' templates current), started at
 * startup by InitService. The browser extension runs the same work.
 */
@Injectable({ providedIn: "root" })
export class KeykeeperMspWorkService extends KeykeeperMspWork {
  constructor(
    mspApi: KeykeeperMspApiService,
    sender: KeykeeperTemplateSenderService,
    accountService: AccountService,
    authService: AuthService,
    cipherService: CipherService,
    organizationService: OrganizationService,
    collectionService: CollectionService,
    organizationUserService: OrganizationUserService,
    syncService: SyncService,
    joinChecks: KeykeeperJoinChecksService,
    toastService: ToastService,
    encryptService: EncryptService,
    keyService: KeyService,
  ) {
    super(
      mspApi,
      sender,
      accountService,
      authService,
      cipherService,
      organizationService,
      collectionService,
      organizationUserService,
      syncService,
      joinChecks,
      new KeykeeperScriptRefresher(
        mspApi,
        new KeykeeperScriptCopies(encryptService),
        keyService,
        cipherService,
        accountService,
      ),
    );
    // Said on this device, so an unexpected one is seen where it happened.
    this.letIn$.subscribe(({ email, organizationName }) =>
      toastService.showToast({ variant: "info", message: `Let ${email} into ${organizationName}` }),
    );
  }
}
