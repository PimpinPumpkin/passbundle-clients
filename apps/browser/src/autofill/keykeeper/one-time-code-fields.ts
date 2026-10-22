// Keykeeper: one-time code fields, which the save and update prompts must never
// take for a password field (DESIGN.md, "One-time codes never become
// passwords"). Upstream already skips fields tagged as codes (autocomplete
// "one-time-code", or names like "verification code"). This catches the ones
// a page only calls a "code", masked like a password: on a passwordless
// sign-in page next to an email field, the background's value check can't
// tell such a code from a PIN.

import AutofillField from "../models/autofill-field";

/** Words that make a field a code: "code", "login code", "OTP", "MFA". */
const CODE_WORDS = new Set(["code", "otp", "otc", "totp", "2fa", "mfa"]);
/** Words ending in "code" that aren't one-time codes. */
const NOT_CODES = new Set(["passcode", "pincode", "zipcode", "postcode", "postalcode"]);
/** Words that make a field a password or a PIN, which stay saveable, in the languages we see most. */
const SECRET_WORDS = new Set([
  "password",
  "passwd",
  "pwd",
  "passcode",
  "pin",
  "pincode",
  "passwort",
  "kennwort",
  "passe",
  "contraseña",
  "senha",
  "wachtwoord",
]);

/** What the page says about the field itself, never its type: every masked field's type is "password". */
function fieldWords(field: AutofillField): string[] {
  const values = [
    field.htmlID,
    field.htmlName,
    field.htmlClass,
    field.title,
    field.placeholder,
    field["label-data"],
    field["label-aria"],
    field["label-left"],
    field["label-right"],
    field["label-tag"],
    field["label-top"],
    field["aria-describedby"],
  ];
  const words: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    // "otpInput" and "login_code" as well as "login code".
    const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    words.push(...spaced.split(/[^\p{L}\d]+/u).filter(Boolean));
  }
  return words;
}

/**
 * True when the page calls a field a one-time code ("Enter the code we sent
 * you", "Login code", id "otp") and nothing about it says password or PIN.
 * An autocomplete hint for a password says the site means a password.
 */
export function isOneTimeCodeField(field: AutofillField): boolean {
  if (/password/i.test(field.autoCompleteType ?? "")) {
    return false;
  }
  const words = fieldWords(field);
  if (words.some((word) => SECRET_WORDS.has(word))) {
    return false;
  }
  return words.some(
    (word) => CODE_WORDS.has(word) || (word.endsWith("code") && !NOT_CODES.has(word)),
  );
}
