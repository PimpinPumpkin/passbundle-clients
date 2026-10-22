// Keykeeper: the generator's settings follow someone to each of their devices
// (DESIGN.md, "Generator settings"). The apps keep them on the server in a
// small document encrypted with the account's key; this is that document's
// generator part and how it maps to upstream's settings. The names are the
// PassBundle apps' (core/src/generator.rs), so every app reads the same thing.
import { Algorithm } from "../metadata";
import { PassphraseGenerationOptions, PasswordGeneratorSettings } from "../types";

/** The generator's settings, as every PassBundle app keeps them. */
export type SyncedGenerator = {
  kind: "password" | "passphrase";
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
  minDigits: number;
  minSymbols: number;
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
};

/** What the document says it is, so nothing else encrypted with the
 *  account's key (an item's name, say) passes for it. */
export const SETTINGS_TYPE = "passbundle.settings";

/**
 * The whole document. Settings this app doesn't know are kept as they are.
 * `rev` numbers each save, never lower than one before it, so an app can
 * refuse an older copy a server hands back.
 */
export type SyncedSettings = {
  type?: string;
  rev?: number;
  generator?: Partial<SyncedGenerator>;
} & Record<string, unknown>;

/** A document's number; 0 for none. */
export function revOf(settings: SyncedSettings | null | undefined): number {
  const rev = settings?.rev;
  return typeof rev === "number" && Number.isSafeInteger(rev) && rev > 0 ? rev : 0;
}

/** The number for the next save: after every one seen, and the time, in
 *  milliseconds, so a later save on another device numbers higher too. */
export function nextRev(seen: number, now = Date.now()): number {
  return Math.max(seen + 1, now);
}

/** Upstream's three pieces: password and passphrase settings, and which one. */
export type LocalGenerator = {
  password: PasswordGeneratorSettings;
  passphrase: PassphraseGenerationOptions;
  algorithm: typeof Algorithm.password | typeof Algorithm.passphrase;
};

/** The generator's settings in the shared document's terms. */
export function toSynced(local: LocalGenerator): SyncedGenerator {
  const { password: p, passphrase: w } = local;
  return {
    kind: local.algorithm === Algorithm.passphrase ? "passphrase" : "password",
    length: p.length ?? 20,
    uppercase: p.uppercase ?? true,
    lowercase: p.lowercase ?? true,
    digits: p.number ?? true,
    symbols: p.special ?? true,
    avoidAmbiguous: !(p.ambiguous ?? false),
    minDigits: p.minNumber ?? 1,
    minSymbols: p.minSpecial ?? 1,
    words: w.numWords ?? 6,
    separator: w.wordSeparator ?? "-",
    capitalize: w.capitalize ?? false,
    includeNumber: w.includeNumber ?? false,
  };
}

const whole = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
const yesNo = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/**
 * The shared document's generator settings applied over what's here. Each
 * one that's missing or isn't what it should be keeps its value here, and
 * numbers are held to what upstream's generator allows.
 */
export function fromSynced(
  synced: Partial<SyncedGenerator> | undefined,
  local: LocalGenerator,
): LocalGenerator {
  const s = (synced ?? {}) as Record<string, unknown>;
  const pick = <T>(value: T | undefined, otherwise: T): T =>
    value === undefined ? otherwise : value;
  const avoid = yesNo(s.avoidAmbiguous);
  const separator =
    typeof s.separator === "string" ? Array.from(s.separator).slice(0, 1).join("") : undefined;
  return {
    algorithm:
      s.kind === "passphrase"
        ? Algorithm.passphrase
        : s.kind === "password"
          ? Algorithm.password
          : local.algorithm,
    password: {
      ...local.password,
      length: pick(whole(s.length, 5, 128), local.password.length),
      uppercase: pick(yesNo(s.uppercase), local.password.uppercase),
      lowercase: pick(yesNo(s.lowercase), local.password.lowercase),
      number: pick(yesNo(s.digits), local.password.number),
      special: pick(yesNo(s.symbols), local.password.special),
      ambiguous: avoid === undefined ? local.password.ambiguous : !avoid,
      minNumber: pick(whole(s.minDigits, 0, 9), local.password.minNumber),
      minSpecial: pick(whole(s.minSymbols, 0, 9), local.password.minSpecial),
    },
    passphrase: {
      ...local.passphrase,
      numWords: pick(whole(s.words, 3, 20), local.passphrase.numWords),
      wordSeparator: pick(separator, local.passphrase.wordSeparator),
      capitalize: pick(yesNo(s.capitalize), local.passphrase.capitalize),
      includeNumber: pick(yesNo(s.includeNumber), local.passphrase.includeNumber),
    },
  };
}

/** The document as text, the same way every time, to compare and encrypt. */
export function settingsText(settings: SyncedSettings): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value != null && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
          )
        : value;
  return JSON.stringify(sorted(settings));
}

/** The document from its text, or nothing if it isn't one. */
export function parseSettings(text: string): SyncedSettings | null {
  try {
    const value: unknown = JSON.parse(text);
    return value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as SyncedSettings).type === SETTINGS_TYPE
      ? (value as SyncedSettings)
      : null;
  } catch {
    return null;
  }
}
