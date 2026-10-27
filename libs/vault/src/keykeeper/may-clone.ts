// Keykeeper: who may copy an item (Clone), on every way in, the address
// included (DESIGN.md, "Folders and permissions"). A copy would be the
// person's own, so it needs see passwords on the item, and for an
// organization's item, share in one of its shared folders (canCloneCipher$).
// The form behind it builds a copy of an item whose secrets the person can't
// see from its plain values only, as a backstop (cipher-form.component.ts).

import { firstValueFrom } from "rxjs";

import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherAuthorizationService } from "@bitwarden/common/vault/services/cipher-authorization.service";
import { CipherLike } from "@bitwarden/common/vault/types/cipher-like";

/** The message a page shows when it refuses a copy. */
export const CANT_COPY_ITEM_KEY = "keykeeperCantCopyItem";

/** Whether the person may copy this item: see passwords on it, and canCloneCipher$. */
export async function mayCloneItem(
  cipherAuthorizationService: CipherAuthorizationService,
  cipher: CipherLike | null | undefined,
  isAdminConsoleAction?: boolean,
): Promise<boolean> {
  if (cipher == null || !maySeeSecrets(cipher)) {
    return false;
  }
  return await firstValueFrom(
    cipherAuthorizationService.canCloneCipher$(cipher, isAdminConsoleAction),
  );
}
