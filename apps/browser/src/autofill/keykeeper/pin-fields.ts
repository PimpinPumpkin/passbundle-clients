// Keykeeper: a PIN beside a password. A sign-in that asks for a password and
// a separate PIN, both masked, has two password fields in one form, which
// upstream reads as a sign-up (a new password, typed twice): no field gets the
// logins' menu, and a fill would put the password in the PIN box too. A masked
// field the page marks as a PIN isn't a second password. See DESIGN.md, "How
// it keeps getting better".
//
// What marks a PIN, from what the page says about the field itself:
//
// - Its autocomplete hint: "current-password" or "new-password" says it's a
//   password, and wins over everything below. "one-time-code", or a hint that
//   names a PIN, says it's a PIN.
// - Its id, name, label, title, or placeholder naming a PIN, a passcode, or a
//   security code, in English or German (the corpus's languages): "PIN",
//   "pin_code", "Passcode", "Security code", "Geheimzahl".
// - Otherwise, when those don't name a password or a password typed again
//   ("Password", "Kennwort", "Confirm", "Repeat it"): inputmode="numeric", a
//   pattern of digits only, or a maxlength of 8 or less.
//
// Only beside a password: a PIN is left out only where the same form (or,
// without one, the page) has a masked field people can see that isn't a PIN.
// A PIN that's the only masked field (a sign-in with a PIN) is still the
// password, as upstream has it, and so are masked fields that are all PINs.
//
// This file has no imports beyond types, so the content script can use it too.

import type AutofillField from "../models/autofill-field";
import type AutofillPageDetails from "../models/autofill-page-details";

/** Words, and two words run together, that name a PIN. */
const PIN_NAMES = new Set([
  "pin",
  "pincode",
  "pinnumber",
  "passcode",
  "securitycode",
  "securitypin",
  "pinnummer",
  "geheimzahl",
  "geheimnummer",
  "sicherheitscode",
  "sicherheitspin",
]);

/** Words that name a password, or one typed again, as a sign-up or a change asks. */
const PASSWORD_WORDS = new Set([
  "password",
  "passwd",
  "passphrase",
  "pass",
  "pwd",
  "pw",
  "passwort",
  "kennwort",
  "confirm",
  "confirmation",
  "repeat",
  "retype",
  "reenter",
  "again",
  "verify",
  "bestatigen",
  "bestatigung",
  "wiederholen",
  "wiederholung",
  "erneut",
  "nochmal",
]);

/** A pattern of digits only: \d*, [0-9]+, \d{4}, [0-9]{4,6}, anchored or not. */
const DIGITS_PATTERN = /^\^?(?:\\d|\[0-9\])(?:[*+]|\{\d+(?:,\d*)?\})?\$?$/;

/** The longest maxlength a PIN's box has. */
const PIN_MAX_LENGTH = 8;

/**
 * The attributes a PIN shows in that page details don't otherwise keep, read
 * from the element when its details are collected. Only the ones it has.
 */
export function pinAttributes(element: Element): Pick<AutofillField, "inputMode" | "pattern"> {
  const found: Pick<AutofillField, "inputMode" | "pattern"> = {};
  const inputMode = element.getAttribute("inputmode");
  if (inputMode != null) {
    found.inputMode = inputMode;
  }
  const pattern = element.getAttribute("pattern");
  if (pattern != null) {
    found.pattern = pattern;
  }
  return found;
}

/** A value's words: lower case, accents dropped, split at anything but a letter and at fooBar. */
function words(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/** Whether the words, or any two of them in a row run together, include one of these. */
function says(found: string[], names: Set<string>): boolean {
  return found.some((word, i) => names.has(word) || names.has(word + (found[i + 1] ?? "")));
}

/** What the page says about the field itself. Not the text around it, which may be the next field's. */
function fieldWords(field: AutofillField): string[] {
  return [
    field.autoCompleteType,
    field.htmlID,
    field.htmlName,
    field.title,
    field.placeholder,
    field["label-tag"],
    field["label-aria"],
    field["label-data"],
    field["label-top"],
  ].flatMap(words);
}

/** True when the page marks a masked field as a PIN rather than a password (see above). */
export function isPinField(field: AutofillField): boolean {
  if (field.type !== "password") {
    return false;
  }
  const hints =
    typeof field.autoCompleteType === "string"
      ? field.autoCompleteType.toLowerCase().split(/\s+/)
      : [];
  if (hints.includes("current-password") || hints.includes("new-password")) {
    return false;
  }
  if (hints.includes("one-time-code")) {
    return true;
  }
  const found = fieldWords(field);
  if (says(found, PIN_NAMES)) {
    return true;
  }
  if (says(found, PASSWORD_WORDS)) {
    return false;
  }
  const inputMode = typeof field.inputMode === "string" ? field.inputMode.trim().toLowerCase() : "";
  const pattern = typeof field.pattern === "string" ? field.pattern.trim() : "";
  const maxLength = typeof field.maxLength === "number" ? field.maxLength : 0;
  return (
    inputMode === "numeric" ||
    DIGITS_PATTERN.test(pattern) ||
    (maxLength > 0 && maxLength <= PIN_MAX_LENGTH)
  );
}

/** The form a field is in; fields without one are all in the page's. */
const formOf = (field: AutofillField) => field.form ?? null;

/** The PINs that sit beside a password, in the same form (or, without one, on the same page). */
export function pinsBesidePasswords(fields: AutofillField[]): Set<AutofillField> {
  const masked = fields.filter((field) => field.type === "password");
  const pins = masked.filter(isPinField);
  const withPassword = new Set(
    masked.filter((field) => field.viewable === true && !pins.includes(field)).map(formOf),
  );
  return new Set(pins.filter((pin) => withPassword.has(formOf(pin))));
}

/** Whether the field is a PIN beside a password on this page. */
export function isPinBesidePassword(
  field: AutofillField,
  pageDetails: Pick<AutofillPageDetails, "fields">,
): boolean {
  return (
    isPinField(field) &&
    pageDetails.fields.some(
      (other) =>
        other.type === "password" &&
        other.viewable === true &&
        formOf(other) === formOf(field) &&
        !isPinField(other),
    )
  );
}

/**
 * The page as upstream's rules should read it: without the PINs beside a
 * password. The same page details when there are none.
 */
export function withoutPinsBesidePasswords<T extends Pick<AutofillPageDetails, "fields">>(
  pageDetails: T,
): T {
  const pins = pinsBesidePasswords(pageDetails.fields);
  return pins.size
    ? { ...pageDetails, fields: pageDetails.fields.filter((field) => !pins.has(field)) }
    : pageDetails;
}
