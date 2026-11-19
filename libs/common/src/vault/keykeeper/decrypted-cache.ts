// Keykeeper: the decrypted copy of the vault that CipherService keeps in
// memory (DECRYPTED_CIPHERS) is used only while it is still the stored items.
//
// Upstream clears the copy before every change to the stored items, and
// whoever decrypts next fills it again. In the browser extension the copy is
// shared: the background and every open extension page (the popup, a popped-out
// vault window, the popup opened as a tab) read and write the same one, through
// the background's session storage. A page that started decrypting before a
// save cleared the copy still writes its older copy when it finishes, after
// the clear (a newer emission drops the older result, not its write), and the
// background then trusted that copy until the next change: a passkey saved a
// moment before missing from excludeCredentials, or an item just saved or
// changed missing from what fills (DESIGN.md, "Passkeys").

import { CipherData } from "../models/data/cipher.data";
import { CipherView } from "../models/view/cipher.view";

type Decrypted = Pick<
  CipherView,
  "id" | "revisionDate" | "deletedDate" | "archivedDate" | "folderId"
>;
type Stored = Pick<CipherData, "revisionDate" | "deletedDate" | "archivedDate" | "folderId">;

const time = (date: Date | string | null | undefined) =>
  date == null ? null : new Date(date).getTime();

/**
 * Whether a decrypted item was decrypted from the stored one as it is now: the
 * same revision, and the same trash, archive, and folder, which some changes
 * set on the device without a new revision.
 */
const sameAs = (view: Decrypted, stored: Stored | undefined) =>
  stored != null &&
  time(view.revisionDate) === time(stored.revisionDate) &&
  time(view.deletedDate) === time(stored.deletedDate) &&
  time(view.archivedDate) === time(stored.archivedDate) &&
  (view.folderId ?? null) === (stored.folderId ?? null);

/**
 * Whether the decrypted copy is the stored items as they are now: each item in
 * it is stored, unchanged since it was decrypted, and each stored item is in
 * it, or among the items that couldn't be decrypted (as they are now, too).
 */
export function decryptedCacheIsCurrent(
  cached: readonly Decrypted[],
  failed: readonly Decrypted[] | null | undefined,
  stored: Readonly<Record<string, Stored>> | null | undefined,
): boolean {
  const items = stored ?? {};
  const accounted = new Set<string>();
  for (const view of cached) {
    if (view.id == null || !sameAs(view, items[view.id])) {
      return false;
    }
    accounted.add(view.id);
  }
  for (const view of failed ?? []) {
    if (view.id != null && sameAs(view, items[view.id])) {
      accounted.add(view.id);
    }
  }
  return Object.keys(items).every((id) => accounted.has(id));
}
