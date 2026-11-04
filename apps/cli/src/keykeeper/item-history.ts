// Keykeeper: an item's earlier versions in the command-line tool (DESIGN.md,
// "Item history", in the meta repo), read-only: `get history <item>`. The
// server decides who gets what (passbundle-server, keykeeper_cipher_history.rs):
// nothing without "view item history" in one of the item's shared folders (it
// answers 404, as for an item that isn't there), and when and by whom only
// without "see passwords" in the same folder. As in the web vault, a version
// is never decrypted for someone the item says can't see its passwords,
// whatever the server sends. Restoring and deleting versions stay in the web
// vault and the extension for now.

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherData } from "@bitwarden/common/vault/models/data/cipher.data";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherResponse as ApiCipherResponse } from "@bitwarden/common/vault/models/response/cipher.response";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { BaseResponse } from "../models/response/base.response";
import { CipherResponse } from "../vault/models/cipher.response";

/** Who saved a version, as the server lets the caller see them. */
export type VersionEditor = { id: string | null; name: string | null; email: string | null };

/** GET /api/keykeeper/ciphers/<id>/history (libs/vault/src/keykeeper/item-versions.ts). */
export type ItemHistoryApiResponse = {
  cipherId: string;
  revisionDate: string;
  savedBy: VersionEditor | null;
  hidePasswords: boolean;
  data: {
    id: string;
    revisionDate: string;
    savedBy: VersionEditor | null;
    replacedDate: string;
    replacedBy: VersionEditor | null;
    cipher: unknown;
  }[];
};

export const historyPath = (cipherId: string) => `/keykeeper/ciphers/${cipherId}/history`;

/** One earlier version, newest first, as `get history` lists it. */
export class ItemVersionResponse implements BaseResponse {
  object = "itemVersion";
  id: string;
  /** When this version was saved, and by whom. */
  revisionDate: string;
  savedBy: VersionEditor | null;
  /** When the next save replaced it, and by whom. */
  replacedDate: string;
  replacedBy: VersionEditor | null;
  /**
   * The item as this version had it; null for someone who can't see the
   * item's passwords, or a version that couldn't be decrypted (`unreadable`).
   */
  item: CipherResponse | null;
  unreadable?: boolean;

  constructor(
    version: ItemHistoryApiResponse["data"][number],
    item: CipherResponse | null,
    unreadable = false,
  ) {
    this.id = version.id;
    this.revisionDate = version.revisionDate;
    this.savedBy = version.savedBy ?? null;
    this.replacedDate = version.replacedDate;
    this.replacedBy = version.replacedBy ?? null;
    this.item = item;
    if (unreadable) {
      this.unreadable = true;
    }
  }
}

type Decrypt = (cipher: Cipher) => Promise<CipherView | null>;

/** The item's versions, newest first, decrypted where the person may read them. */
export async function itemHistory(
  apiService: ApiService,
  current: CipherView,
  decrypt: Decrypt,
): Promise<ItemVersionResponse[]> {
  const response: ItemHistoryApiResponse = await apiService.send(
    "GET",
    historyPath(current.id),
    null,
    true,
    true,
  );
  const contents = !response?.hidePasswords && maySeeSecrets(current);
  const versions: ItemVersionResponse[] = [];
  for (const version of response?.data ?? []) {
    if (!contents || version.cipher == null) {
      versions.push(new ItemVersionResponse(version, null));
      continue;
    }
    // Decrypted as the vault decrypts any item from the server.
    const cipher = new Cipher(new CipherData(new ApiCipherResponse(version.cipher)));
    const view = await decrypt(cipher).catch((): CipherView | null => null);
    if (view == null || view.decryptionFailure) {
      versions.push(new ItemVersionResponse(version, null, true));
      continue;
    }
    // The server sent its contents, and the item says the person may see its
    // passwords, so the version shows as the item does.
    view.viewPassword = true;
    versions.push(new ItemVersionResponse(version, new CipherResponse(view)));
  }
  return versions;
}
