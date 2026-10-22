import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";

/** Set when someone has just signed up in this tab (registration-finish). */
export const SETUP_IMPORT = "keykeeper.setupImport";

/**
 * Keykeeper: someone who has just signed up in this tab gets the offer to
 * bring their passwords over (setup-import) before their vault opens, once,
 * and only while the vault is empty. Not on a phone's browser, where exports
 * are hard to come by.
 */
export const setupImportRedirectGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const accountService = inject(AccountService);
  const cipherService = inject(CipherService);

  let justSignedUp = false;
  try {
    justSignedUp = sessionStorage.getItem(SETUP_IMPORT) === "1";
  } catch {
    return true;
  }
  if (!justSignedUp) {
    return true;
  }
  const forget = () => {
    try {
      sessionStorage.removeItem(SETUP_IMPORT);
    } catch {
      // Nothing kept to forget.
    }
  };
  if (Utils.isMobileBrowser) {
    forget();
    return true;
  }
  const userId = await firstValueFrom(accountService.activeAccount$.pipe(getUserId));
  const ciphers = await firstValueFrom(cipherService.ciphers$(userId)).catch(() => null);
  if (ciphers == null || Object.keys(ciphers).length > 0) {
    forget();
    return true;
  }
  return router.createUrlTree(["/setup-import"]);
};
