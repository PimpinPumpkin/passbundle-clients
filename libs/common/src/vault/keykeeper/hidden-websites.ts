// Keykeeper: someone who can't see an item's passwords can't change its
// websites, since autofill sends the password wherever the websites point
// (DESIGN.md, "Folders and permissions"). The apps don't let them edit the
// websites, and a save sends the websites exactly as stored, encrypted as
// they were, so the server can refuse any change it sees (it never sees the
// addresses themselves).

import { Cipher } from "../models/domain/cipher";
import { CipherView } from "../models/view/cipher.view";

/** The websites as the person sees them: each address and how it's matched. */
const websites = (view: CipherView | null | undefined) =>
  JSON.stringify((view?.login?.uris ?? []).map((u) => [u.uri ?? null, u.match ?? null]));

/**
 * Puts an item's stored websites (as encrypted) into the copy about to be
 * saved, when the person can't see its passwords. Checks that they still
 * open, under the key the item is saved with, as the same websites; refuses
 * the save when they wouldn't (an edit that changed them, or an item key that
 * changed with it).
 */
export async function keepHiddenItemWebsites(
  toSave: Cipher,
  stored: Cipher | null | undefined,
  decrypt: (cipher: Cipher) => Promise<CipherView>,
): Promise<void> {
  if (
    stored == null ||
    stored.organizationId == null ||
    stored.viewPassword !== false ||
    stored.login == null ||
    toSave.login == null
  ) {
    return;
  }
  const sent = toSave.login.uris;
  toSave.login.uris = stored.login.uris;
  const [kept, before] = await Promise.all([
    decrypt(toSave).catch((): CipherView | null => null),
    decrypt(stored).catch((): CipherView | null => null),
  ]);
  if (kept == null || before == null || websites(kept) !== websites(before)) {
    toSave.login.uris = sent;
    throw new Error(
      "You can't see this item's passwords, so its websites stay as they are. Ask someone who can see them to change them.",
    );
  }
}
