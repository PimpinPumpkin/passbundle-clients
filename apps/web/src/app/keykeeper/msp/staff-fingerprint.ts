// Keykeeper: each staff member's fingerprint phrase on the MSP console's
// Staff list (DESIGN.md, "Key fingerprints"). Staff get each client's key when
// an MSP admin's console confirms them, encrypted to the public key the
// server gives for them. The phrase is upstream's, made here from that key and
// the person's account id, the same words their own Settings, My account
// shows from the key their device holds, so someone who compares the two can
// tell whether the server handed out a key of its own. Showing it changes
// nothing about who is confirmed, or when.

import { Utils } from "@bitwarden/common/platform/misc/utils";

/** Upstream's fingerprint phrase maker (LegacyCompatKeyService.getFingerprint). */
export type FingerprintMaker = {
  getFingerprint(fingerprintMaterial: string, publicKey: Uint8Array): Promise<string[]>;
};

/** A staff member as the server lists them, with the public key it holds for them. */
export type StaffKey = { userId: string; publicKey?: string | null };

/**
 * A staff member's phrase, words joined by hyphens as account settings show
 * it, or null when the server gives no key for them (an older server, or an
 * account that has no keys yet) or one that can't be read.
 */
export async function staffPhrase(
  maker: FingerprintMaker,
  person: StaffKey,
): Promise<string | null> {
  if (person.publicKey == null || person.publicKey === "") {
    return null;
  }
  try {
    const words = await maker.getFingerprint(person.userId, Utils.fromB64ToArray(person.publicKey));
    return words.length > 0 ? words.join("-") : null;
  } catch {
    return null;
  }
}

/** Every staff member's phrase, by account id; those without one are left out. */
export async function staffPhrases(
  maker: FingerprintMaker,
  staff: StaffKey[],
): Promise<Map<string, string>> {
  const phrases = new Map<string, string>();
  for (const person of staff) {
    const phrase = await staffPhrase(maker, person);
    if (phrase != null) {
      phrases.set(person.userId, phrase);
    }
  }
  return phrases;
}

/**
 * What to compare, and how: the person reads their own phrase to whoever is
 * looking at the Staff list. Someone looking at their own row can check it
 * themselves.
 */
export function compareLine(
  person: { name: string | null; email: string },
  isYou: boolean,
): string {
  if (isYou) {
    return "Yours. Your Settings, My account shows the same phrase. If it's different, tell us.";
  }
  const who = person.name?.trim() || person.email;
  return `Ask ${who} to read the phrase in Settings, My account. If it's different, remove them and tell us.`;
}
