// Keykeeper: card fields upstream's fill script got wrong (DESIGN.md,
// "Addresses and cards", "What fills today, and what we fixed", in the meta
// repo). Called from upstream's generateCardFillScript in `// Keykeeper:`
// blocks:
//
// - A field's own autocomplete hint decides first: `cc-name`, `cc-number`,
//   and the rest of the card's hints take their fields before any guessing,
//   and a field whose hint names something else (`shipping name`,
//   `address-level2`, `email`) is never guessed into a card.
// - `cc-given-name` and `cc-family-name` get the parts of the name on the card.
// - Look-alike words: the CVV's "cid" and the month's "card-m" match only as
//   whole words, not inside "cidade" or "Cardmember name".
// - Month and year lists are matched by their options' values and words, and
//   left alone when nothing matches.

import AutofillField from "../models/autofill-field";

/** The parts of a card a field can take. */
export type CardSlot =
  | "cardholderName"
  | "cardholderGivenName"
  | "cardholderFamilyName"
  | "number"
  | "exp"
  | "expMonth"
  | "expYear"
  | "code"
  | "brand";

const CARD_HINTS: Record<string, CardSlot> = {
  "cc-name": "cardholderName",
  "cc-given-name": "cardholderGivenName",
  "cc-family-name": "cardholderFamilyName",
  "cc-number": "number",
  "cc-exp": "exp",
  "cc-exp-month": "expMonth",
  "cc-exp-year": "expYear",
  "cc-csc": "code",
  "cc-type": "brand",
};

/** The HTML standard's autofill field names (WHATWG, "Autofill"). */
const AUTOFILL_FIELD_NAMES = new Set([
  "name",
  "honorific-prefix",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-suffix",
  "nickname",
  "username",
  "new-password",
  "current-password",
  "one-time-code",
  "organization-title",
  "organization",
  "street-address",
  "address-line1",
  "address-line2",
  "address-line3",
  "address-level4",
  "address-level3",
  "address-level2",
  "address-level1",
  "country",
  "country-name",
  "postal-code",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-type",
  "transaction-currency",
  "transaction-amount",
  "language",
  "bday",
  "bday-day",
  "bday-month",
  "bday-year",
  "sex",
  "url",
  "photo",
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-local-prefix",
  "tel-local-suffix",
  "tel-extension",
  "email",
  "impp",
]);

/** Tokens before the field name: a section, shipping or billing, a kind of contact, webauthn. */
const HINT_PREFIXES = /^(section-.*|shipping|billing|home|work|mobile|fax|pager|webauthn)$/;

/**
 * The autofill field name a field's autocomplete attribute gives, such as
 * "cc-number" for `autocomplete="section-pay billing cc-number"`; null for
 * none, "on", "off", or anything the standard doesn't name.
 */
export function autofillHint(field: Pick<AutofillField, "autoCompleteType">): string | null {
  const tokens = (field.autoCompleteType ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const name = tokens.filter((t) => !HINT_PREFIXES.test(t)).pop();
  return name != null && AUTOFILL_FIELD_NAMES.has(name) ? name : null;
}

/**
 * The card's fields by their autocomplete hints, the first visible field of
 * each, and the fields upstream's guessing must leave alone: those already
 * taken here, and those whose hint names something that isn't on a card.
 */
export function cardFieldsByHint(fields: AutofillField[]): {
  slots: Partial<Record<CardSlot, AutofillField>>;
  leave: Set<string>;
} {
  const slots: Partial<Record<CardSlot, AutofillField>> = {};
  const leave = new Set<string>();
  for (const field of fields) {
    const hint = autofillHint(field);
    if (hint == null || field.opid == null) {
      continue;
    }
    leave.add(field.opid);
    const slot = CARD_HINTS[hint];
    if (slot != null && field.viewable && slots[slot] == null) {
      slots[slot] = field;
    }
  }
  return { slots, leave };
}

/**
 * Whether a field's name, id, or label matched a card keyword only as part of
 * another word: the CVV's "cid" inside "cidade" (a city), or the month's
 * "card-m" inside "Cardmember name". Such keywords count only as whole words.
 */
export function looksAlike(value: string, slot: "code" | "expMonth"): boolean {
  // Words, with camelCase split apart: "cardMonth" is "card Month".
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const loose = words.replace(/[^a-z0-9]+/g, "");
  if (slot === "code") {
    // Upstream's other CVV words are unambiguous; only "cid" hides in words.
    const onlyCid = loose.includes("cid") && !/(cvv|cvc|csc|cvd|cvn|cnv)/.test(loose);
    return onlyCid && !/(^|[^a-z])cid([^a-z]|$)/.test(words);
  }
  // "card-m", "cc-m", and "exp-m" count only where the m ends the word.
  const onlyShort = /(cardm|ccm|expm)/.test(loose) && !/(month|mon\b|mo\b|mm|mois)/.test(words);
  return onlyShort && !/(card|cc|exp)[^a-z0-9]?m(?![a-z])/.test(words);
}

/** The name on a card, in parts: all but the last word, and the last word. */
export function nameParts(name: string | null | undefined): { given: string; family: string } {
  const words = (typeof name === "string" ? name : "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return { given: words[0] ?? "", family: "" };
  }
  return { given: words.slice(0, -1).join(" "), family: words[words.length - 1] };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A list's options, as upstream collects them: [its words, lowercase without spaces or punctuation; its value]. */
export type SelectOptions = (string | null)[][];

/**
 * The value of the option in a month list for the card's month: by its value
 * ("3" or "03"), then its words ("03", "March", "Mar", "03 - March"). Null when
 * none matches, so the list is left as it is.
 */
export function monthOption(options: SelectOptions, month: string): string | null {
  const m = parseInt(month, 10);
  if (!(m >= 1 && m <= 12)) {
    return null;
  }
  const numbers = [String(m), String(m).padStart(2, "0")];
  const full = MONTHS[m - 1];
  const short = full.slice(0, 3);
  const valueOf = (o: (string | null)[]) => o[1] ?? null;
  // Its name first: a list numbered from 0 still says "March" for March.
  const byName = options.find((o) => {
    const words = o[0] ?? "";
    return words === full || words === short || words.includes(full);
  });
  if (byName != null) {
    return valueOf(byName);
  }
  const byValue = options.find((o) => numbers.includes((valueOf(o) ?? "").trim()));
  if (byValue != null) {
    return valueOf(byValue);
  }
  const byNumber = options.find((o) => new RegExp(`^0?${m}(?![0-9])`).test(o[0] ?? ""));
  return byNumber != null ? valueOf(byNumber) : null;
}

/** Whether a list has an option with this value, so filling it chooses one. */
export function hasOptionValue(options: SelectOptions, value: string): boolean {
  return options.some((o) => o[1] === value);
}

/**
 * The value of the option in a year list for the card's year, whether the list
 * says "2027" or "27"; null when none matches.
 */
export function yearOption(options: SelectOptions, year: string): string | null {
  const digits = year.trim();
  if (!/^\d{2}(\d{2})?$/.test(digits)) {
    return null;
  }
  const full = digits.length === 2 ? `20${digits}` : digits;
  const short = full.slice(2);
  const found = options.find((o) =>
    [o[1], o[0]].some((v) => v != null && (v.trim() === full || v.trim() === short)),
  );
  return found != null ? (found[1] ?? null) : null;
}
