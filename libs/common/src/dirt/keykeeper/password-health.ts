// Keykeeper: which passwords need fixing, by one set of rules for every place
// that counts them: the Health reports (a person's own and each
// organization's), the count beside Health in the menu, and the MSP console.
// The rules are upstream's reports'; they live here so every count agrees.
// See DESIGN.md, "Health (better than Watchtower)".

import { CipherType } from "../../vault/enums";
import { CipherView } from "../../vault/models/view/cipher.view";

/** A password's strength score from 0 to 4, given hints that make it weaker. */
export type StrengthScorer = (password: string, hints: string[] | null) => number | null;

/** The parts of a username that make a password easier to guess, as upstream's weak report uses them. */
export function usernameHints(username: string | null | undefined): string[] {
  const trimmed = (username ?? "").trim().toLowerCase();
  const local = trimmed.includes("@") ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  return local.split(/[^A-Za-z0-9]/).filter((part) => part.length >= 3);
}

/**
 * Whether Health looks at an item's password: a login with a password the
 * person may see, not in the trash. A person's own Health also needs the item
 * to be theirs to edit (`needsEdit`); an organization's reports and the MSP
 * console look at every item they're given, as admins.
 */
export function checksPassword(cipher: CipherView, needsEdit: boolean): boolean {
  return (
    cipher.type === CipherType.Login &&
    cipher.login?.password != null &&
    cipher.login.password !== "" &&
    !cipher.isDeleted &&
    cipher.viewPassword &&
    (!needsEdit || cipher.edit)
  );
}

/** A login's password score, with its username's parts as hints. */
export function passwordScore(cipher: CipherView, score: StrengthScorer): number | null {
  const hints = usernameHints(cipher.login?.username);
  return score(cipher.login.password, hints.length > 0 ? hints : null);
}

/** Weak is a score of 2 or less out of 4. */
export function isWeakScore(score: number | null | undefined): boolean {
  return score != null && score <= 2;
}

/**
 * The items whose password another item in the same group also uses, in the
 * order given. Pass only items Health checks (`checksPassword`). The MSP
 * console groups by client, since a password shared between two clients isn't
 * one client's reuse; a person's Health is one group.
 */
export function reusedPasswords<C extends CipherView>(
  ciphers: C[],
  group: (cipher: C) => string = () => "",
): C[] {
  const uses = new Map<string, number>();
  const key = (cipher: C) => `${group(cipher)}\u0000${cipher.login.password}`;
  for (const cipher of ciphers) {
    uses.set(key(cipher), (uses.get(key(cipher)) ?? 0) + 1);
  }
  return ciphers.filter((cipher) => (uses.get(key(cipher)) ?? 0) > 1);
}

/** What's wrong with one item's password. */
export type PasswordProblems = {
  cipher: CipherView;
  weak: boolean;
  reused: boolean;
  /**
   * Times the password was seen in known breaches: 0 for none, null when it
   * couldn't be checked, undefined when it hasn't been checked yet.
   */
  exposed: number | null | undefined;
};

export type PasswordProblemsOptions = {
  /** A person's own Health needs items they can edit; see checksPassword. */
  needsEdit: boolean;
  /** Whether an item's password is weak; usually isWeakScore(passwordScore(...)). */
  weak: (cipher: CipherView) => boolean;
  /** Reuse is counted within a group; see reusedPasswords. */
  group?: (cipher: CipherView) => string;
  /** The breach check's results, by password; see checkPasswords. Undefined while it runs. */
  exposed?: ReadonlyMap<string, number | null>;
};

/** Every item Health checks, with what's wrong with its password, in the order given. */
export function passwordProblems(
  ciphers: CipherView[],
  options: PasswordProblemsOptions,
): PasswordProblems[] {
  const checked = ciphers.filter((cipher) => checksPassword(cipher, options.needsEdit));
  const reused = new Set(reusedPasswords(checked, options.group));
  return checked.map((cipher) => ({
    cipher,
    weak: options.weak(cipher),
    reused: reused.has(cipher),
    exposed:
      options.exposed === undefined
        ? undefined
        : (options.exposed.get(cipher.login.password) ?? null),
  }));
}

/** Whether an item is one to fix: weak, reused, or exposed. */
export function needsFixing(problems: PasswordProblems): boolean {
  return problems.weak || problems.reused || (problems.exposed ?? 0) > 0;
}
