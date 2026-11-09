// Keykeeper: marking an item as a favorite, for the item's own menu and for
// several selected items alike (DESIGN.md, "Item history" and "Selecting
// several items"). Only the favorite changes, through the partial update, so
// the item isn't encrypted and saved again and its history keeps no copy.

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherData } from "@bitwarden/common/vault/models/data/cipher.data";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

/** Saves one item's favorite on the server and in the local vault. */
export async function saveFavorite(
  apiService: ApiService,
  cipherService: CipherService,
  cipher: CipherView,
  favorite: boolean,
  userId: UserId,
): Promise<void> {
  const response = await apiService.putPartialCipher(cipher.id, {
    folderId: cipher.folderId,
    favorite,
  });
  await cipherService.upsert(new CipherData(response, cipher.collectionIds), userId);
  cipher.favorite = favorite;
}
