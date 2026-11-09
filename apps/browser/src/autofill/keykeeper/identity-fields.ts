// Keykeeper: a phone number asked for in parts (DESIGN.md, "Addresses and
// cards", "What fills today, and what we fixed", in the meta repo). Upstream's
// identity fill gave each part (`tel-country-code`, `tel-area-code`,
// `tel-local`, and the rest) the whole number, and the country code field the
// identity's country. Called from upstream's generateIdentityFillScript in a
// `// Keykeeper:` block.

import AutofillField from "../models/autofill-field";

import { autofillHint } from "./card-fields";

const PHONE_PARTS = new Set([
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-local-prefix",
  "tel-local-suffix",
  "tel-extension",
]);

/**
 * The phone number's parts, where they're clear: a country code only after a
 * leading "+", and an area code and local number only for a 10-digit North
 * American number (with or without +1).
 */
export function phoneParts(phone: string | null | undefined): Record<string, string> {
  const text = (phone ?? "").trim();
  const digits = text.replace(/\D/g, "");
  const parts: Record<string, string> = {};
  let national = digits;
  if (text.startsWith("+")) {
    const country = text
      .slice(1)
      .trim()
      .split(/[^\d]+/)[0];
    if (country.length > 0 && country.length <= 3 && country.length < digits.length) {
      parts["tel-country-code"] = `+${country}`;
      national = digits.slice(country.length);
    }
  }
  if (national.length > 0 && national !== digits) {
    parts["tel-national"] = national;
  }
  const northAmerican =
    (national.length === 10 && (parts["tel-country-code"] ?? "+1") === "+1") ||
    (!text.startsWith("+") && digits.length === 11 && digits.startsWith("1"));
  if (northAmerican) {
    const ten = national.length === 10 ? national : digits.slice(1);
    parts["tel-national"] = ten;
    parts["tel-area-code"] = ten.slice(0, 3);
    parts["tel-local"] = ten.slice(3);
    parts["tel-local-prefix"] = ten.slice(3, 6);
    parts["tel-local-suffix"] = ten.slice(6);
  }
  return parts;
}

/**
 * For a field that asks for part of a phone number: that part of the
 * identity's number, or null to leave it empty when the part isn't clear.
 * Undefined for any other field, which upstream's matching fills as before.
 */
export function phonePartFor(
  field: Pick<AutofillField, "autoCompleteType">,
  phone: string | null | undefined,
): string | null | undefined {
  const hint = autofillHint(field);
  if (hint == null || !PHONE_PARTS.has(hint)) {
    return undefined;
  }
  return phoneParts(phone)[hint] ?? null;
}
