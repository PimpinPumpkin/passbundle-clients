// Keykeeper: sites' own password rules, so a generated password is one the
// site accepts. The rules are Apple's password rules language
// (https://developer.apple.com/password-rules/), as published for many sites
// in apple/password-manager-resources (site-password-rules.data.ts). The
// parser and generator here are our own. See DESIGN.md, "Health (better than
// Watchtower)".

import { SITE_PASSWORD_RULES } from "./site-password-rules.data";

export type PasswordRules = {
  minLength?: number;
  maxLength?: number;
  /** The most identical characters in a row. */
  maxConsecutive?: number;
  /** Each set needs at least one of its characters in the password. */
  required: string[];
  /** Every character the password may use, or null for any character. */
  allowed: string | null;
};

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGIT = "0123456789";
/** Space through tilde. */
const ASCII_PRINTABLE = String.fromCharCode(...Array.from({ length: 95 }, (_, i) => 32 + i));
/** Apple's "special": every printable ASCII character that isn't a letter or digit, the space too. */
const SPECIAL = [...ASCII_PRINTABLE].filter((c) => !/[A-Za-z0-9]/.test(c)).join("");

const NAMED_CLASSES: Record<string, string> = {
  upper: UPPER,
  lower: LOWER,
  digit: DIGIT,
  special: SPECIAL,
  "ascii-printable": ASCII_PRINTABLE,
};

const unique = (chars: string) => [...new Set(chars)].join("");

/**
 * Reads one property's list of character classes: names like `upper`, and
 * custom sets like `[-().&@?'#,/"+]`, where `]]` at the end puts a `]` in the
 * set. Returns null for anything it doesn't understand. `unicode` means any
 * character.
 */
function parseClasses(value: string): { chars: string; anyCharacter: boolean } | null {
  let chars = "";
  let anyCharacter = false;
  let i = 0;
  while (i < value.length) {
    const c = value[i];
    if (c === " " || c === ",") {
      i++;
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      let set = "";
      while (j < value.length && !(value[j] === "]" && value[j + 1] !== "]")) {
        set += value[j];
        j++;
      }
      if (j >= value.length) {
        return null;
      }
      // As in Apple's parser: only printable ASCII counts, and a "-" only as
      // the set's first character.
      chars += [...set]
        .filter((ch, k) => ASCII_PRINTABLE.includes(ch) && (ch !== "-" || k === 0))
        .join("");
      i = j + 1;
      continue;
    }
    const name = /^[a-z-]+/.exec(value.slice(i))?.[0];
    if (!name) {
      return null;
    }
    if (name === "unicode") {
      anyCharacter = true;
    } else if (NAMED_CLASSES[name]) {
      chars += NAMED_CLASSES[name];
    } else {
      return null;
    }
    i += name.length;
  }
  return { chars: unique(chars), anyCharacter };
}

/** Splits rules text into properties at the semicolons that aren't inside a custom set. */
function properties(text: string): [string, string][] {
  const found: [string, string][] = [];
  let current = "";
  let inSet = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inSet) {
      current += c;
      if (c === "]" && text[i + 1] !== "]") {
        inSet = false;
      }
    } else if (c === "[") {
      inSet = true;
      current += c;
    } else if (c === ";") {
      found.push(splitProperty(current));
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) {
    found.push(splitProperty(current));
  }
  return found.filter(([name]) => name !== "");
}

function splitProperty(text: string): [string, string] {
  const colon = text.indexOf(":");
  return colon < 0
    ? [text.trim().toLowerCase(), ""]
    : [text.slice(0, colon).trim().toLowerCase(), text.slice(colon + 1).trim()];
}

/**
 * Reads rules in Apple's password rules language. Returns null when the text
 * has nothing it can use, or something it can't read: no rules beats rules
 * read wrong.
 */
export function parsePasswordRules(text: string): PasswordRules | null {
  const rules: PasswordRules = { required: [], allowed: null };
  let allowed = "";
  let anyCharacter = false;
  let sawCharacters = false;
  let sawAnything = false;
  for (const [name, value] of properties(text)) {
    if (name === "minlength" || name === "maxlength" || name === "max-consecutive") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        return null;
      }
      sawAnything = true;
      if (name === "minlength") {
        rules.minLength = Math.max(rules.minLength ?? 0, n);
      } else if (name === "maxlength") {
        rules.maxLength = Math.min(rules.maxLength ?? Infinity, n);
      } else {
        rules.maxConsecutive = Math.min(rules.maxConsecutive ?? Infinity, n);
      }
    } else if (name === "required" || name === "allowed") {
      const classes = parseClasses(value);
      if (!classes) {
        return null;
      }
      sawAnything = true;
      sawCharacters = true;
      anyCharacter ||= classes.anyCharacter;
      allowed += classes.chars;
      if (name === "required" && !classes.anyCharacter) {
        rules.required.push(classes.chars);
      }
    }
    // Other properties aren't in the language yet; they don't change what's allowed.
  }
  if (!sawAnything) {
    return null;
  }
  // With no required or allowed characters, any printable ASCII is allowed.
  rules.allowed = anyCharacter ? null : sawCharacters ? unique(allowed) : ASCII_PRINTABLE;
  return rules;
}

/** The rules for a page's host (any port is ignored), from the site's own entry or its parent domain's. */
export function rulesForHost(
  host: string | null | undefined,
  table: Readonly<Record<string, string>> = SITE_PASSWORD_RULES,
): PasswordRules | null {
  const labels = (host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const text = table[labels.slice(i).join(".")];
    if (text != null) {
      return parsePasswordRules(text);
    }
  }
  return null;
}

/** Whether a password follows the rules. */
export function meetsRules(password: string, rules: PasswordRules): boolean {
  const chars = [...password];
  if (rules.minLength != null && chars.length < rules.minLength) {
    return false;
  }
  if (rules.maxLength != null && chars.length > rules.maxLength) {
    return false;
  }
  if (rules.allowed != null && chars.some((c) => !rules.allowed!.includes(c))) {
    return false;
  }
  if (rules.required.some((set) => !chars.some((c) => set.includes(c)))) {
    return false;
  }
  if (rules.maxConsecutive != null) {
    let run = 1;
    for (let i = 1; i < chars.length; i++) {
      run = chars[i] === chars[i - 1] ? run + 1 : 1;
      if (run > rules.maxConsecutive) {
        return false;
      }
    }
  }
  return true;
}

/** A uniformly random integer from 0 to below `n`, from the platform's secure random source. */
export function secureRandomInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % n;
}

/**
 * A random password that follows the rules, as close to `preferredLength` as
 * they allow. Never a space, which sites often trim. Returns null when the
 * rules can't be met that way.
 */
export function passwordForRules(
  rules: PasswordRules,
  preferredLength: number,
  randomInt: (n: number) => number = secureRandomInt,
): string | null {
  const pool = [...(rules.allowed ?? ASCII_PRINTABLE)].filter((c) => c !== " ");
  const required = rules.required.map((set) => [...set].filter((c) => pool.includes(c)));
  if (pool.length === 0 || required.some((set) => set.length === 0)) {
    return null;
  }
  const min = Math.max(rules.minLength ?? 1, required.length);
  const max = rules.maxLength ?? Infinity;
  if (min > max) {
    return null;
  }
  const length = Math.min(Math.max(preferredLength, min), max);
  const pick = (set: string[]) => set[randomInt(set.length)];
  for (let attempt = 0; attempt < 100; attempt++) {
    const chars = required.map(pick);
    while (chars.length < length) {
      chars.push(pick(pool));
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const password = chars.join("");
    if (meetsRules(password, rules)) {
      return password;
    }
  }
  return null;
}

/**
 * The password to offer on a page: the generated one when the site's rules
 * accept it (or the site has none), otherwise one made to its rules. That one
 * keeps the generated password's length and kinds of characters (uppercase,
 * lowercase, digits, symbols) wherever the rules allow, so the generator's
 * settings and an organization's generator policy still count; where they
 * conflict, the site's rules win, since a password the site rejects is no use.
 */
export function passwordForSite(
  generated: string,
  host: string | null | undefined,
  randomInt: (n: number) => number = secureRandomInt,
): string {
  const rules = rulesForHost(host);
  if (!rules || meetsRules(generated, rules)) {
    return generated;
  }
  const length = [...generated].length;
  const kinds = [UPPER, LOWER, DIGIT, SPECIAL]
    .filter((kind) => [...generated].some((c) => kind.includes(c)))
    .map((kind) =>
      [...kind].filter((c) => c !== " " && (rules.allowed ?? ASCII_PRINTABLE).includes(c)).join(""),
    )
    .filter((allowedOfKind) => allowedOfKind !== "");
  return (
    passwordForRules({ ...rules, required: [...rules.required, ...kinds] }, length, randomInt) ??
    passwordForRules(rules, length, randomInt) ??
    generated
  );
}
