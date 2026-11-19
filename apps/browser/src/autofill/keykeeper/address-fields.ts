// Keykeeper: the menu inside a field on address fields known only by their
// name or label (DESIGN.md, "Addresses and cards", "Which fields get the
// menu", in the meta repo). Upstream opens the identities' menu only on a
// field with an address autocomplete hint, or an email field, and never on a
// list (`select`) or a text area. Called from upstream's
// isFieldForIdentityForm and the inline menu's setup in `// Keykeeper:` blocks.
//
// The rule, so a search box or a comment field never gets it:
//
// - The field has no autocomplete hint (one that names something decides as
//   upstream has it).
// - Its name, id, label, or placeholder names an address part as a whole
//   word: the street, the city, the state or province, the postal code, or
//   the country. In a form that asks for an address (below), a name, company,
//   or phone field does too.
// - Nothing in them says it's something else: a search, an email, a comment,
//   a message, notes, instructions, a coupon, a card.
// - A list only for the state or province or the country, a text area only
//   for the street.
// - Its form (or, for a field in no form, the page's fields in no form) asks
//   for at least three of the five address parts, by name or label or by
//   autocomplete hints.

import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";

import { autofillHint } from "./card-fields";

export type AddressPart = "street" | "city" | "state" | "postal" | "country";
type ContactPart = "name" | "company" | "phone";

/**
 * Address words, as whole words or two or three words run together ("address
 * line 1"). The street comes last: "address city" and "address_country" are a
 * city and a country.
 */
const ADDRESS_WORDS: Record<AddressPart, string[]> = {
  country: ["country", "land"],
  state: ["state", "province", "bundesland"],
  city: ["city", "town", "ort", "stadt", "wohnort"],
  postal: ["zip", "zipcode", "postalcode", "postcode", "plz", "postleitzahl"],
  street: [
    "address",
    "addr",
    "street",
    "streetaddress",
    "address1",
    "address2",
    "address3",
    "addressline",
    "addressline1",
    "addressline2",
    "addressline3",
    "addr1",
    "addr2",
    "addr3",
    "street1",
    "street2",
    "street3",
    "strasse",
    "adresse",
  ],
};

/** Words for the rest of an address form, which count only in a form that asks for an address. */
const CONTACT_WORDS: Record<ContactPart, string[]> = {
  name: [
    "name",
    "fullname",
    "firstname",
    "lastname",
    "givenname",
    "familyname",
    "surname",
    "vorname",
    "nachname",
  ],
  company: ["company", "companyname", "organization", "firma"],
  phone: ["phone", "phonenumber", "telephone", "tel", "mobile", "telefon"],
};

/** Words that say a field is something other than an address, wherever they appear. */
const NOT_ADDRESS = new Set([
  "search",
  "query",
  "find",
  "filter",
  "keyword",
  "keywords",
  "captcha",
  "email",
  "mail",
  "ip",
  "url",
  "web",
  "website",
  "comment",
  "comments",
  "message",
  "messages",
  "note",
  "notes",
  "instruction",
  "instructions",
  "description",
  "feedback",
  "subject",
  "coupon",
  "promo",
  "voucher",
  "gift",
  "card",
  "cc",
  "cvv",
  "cvc",
  "password",
  "username",
  "login",
  "nickname",
  "label",
]);

const AUTOCOMPLETE_PARTS: Record<string, AddressPart> = {
  "street-address": "street",
  "address-line1": "street",
  "address-line2": "street",
  "address-line3": "street",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "postal",
  country: "country",
  "country-name": "country",
};

/** A field's element, lowercase: "input", "select", or "textarea". */
function tagOf(field: AutofillField): string {
  const tag = typeof field.tagName === "string" ? field.tagName : "";
  return tag.toLowerCase();
}

/** A field's words: from its name, id, label, and placeholder, camelCase split, lowercase, without accents. */
export function fieldWords(field: AutofillField): string[] {
  const labelled = Boolean(field["label-tag"] || field["label-aria"]);
  const sources = [
    field.htmlName,
    field.htmlID,
    field["label-tag"],
    field["label-aria"],
    field.placeholder,
    field.title,
    // Text beside or above the field only when nothing labels it.
    ...(labelled ? [] : [field["label-left"], field["label-top"]]),
  ];
  return sources
    .filter((s): s is string => typeof s === "string" && s !== "")
    .flatMap((s) =>
      s
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/ß/g, "ss")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
}

/** The words, and each two and three in a row run together. */
function phrases(words: string[]): Set<string> {
  const all = new Set(words);
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) {
      all.add(words[i] + words[i + 1]);
    }
    if (i + 2 < words.length) {
      all.add(words[i] + words[i + 1] + words[i + 2]);
    }
  }
  return all;
}

function partIn<P extends string>(found: Set<string>, table: Record<P, string[]>): P | null {
  for (const [part, words] of Object.entries(table) as [P, string[]][]) {
    if (words.some((w) => found.has(w))) {
      return part;
    }
  }
  return null;
}

/**
 * The address part a field's name, id, label, or placeholder names, or a
 * name, company, or phone; null for none, or for a field whose words say it's
 * something else.
 */
export function addressPartByName(field: AutofillField): AddressPart | ContactPart | null {
  const words = fieldWords(field);
  if (words.some((w) => NOT_ADDRESS.has(w))) {
    return null;
  }
  const found = phrases(words);
  const part = partIn(found, ADDRESS_WORDS);
  const contact = partIn(found, CONTACT_WORDS);
  // "Phone country code" is part of a phone number, which upstream's fill
  // would give the country.
  if (part === "country" && contact === "phone") {
    return null;
  }
  return part ?? contact;
}

/** The address part a field asks for, by its autocomplete hint or its words. */
function addressPartOf(field: AutofillField): AddressPart | null {
  const hint = autofillHint(field);
  if (hint != null) {
    return AUTOCOMPLETE_PARTS[hint] ?? null;
  }
  const part = addressPartByName(field);
  return part != null && part in ADDRESS_WORDS ? (part as AddressPart) : null;
}

/** The address parts a field's form asks for (for a field in no form, the page's fields in no form). */
export function addressPartsInForm(
  field: AutofillField,
  pageDetails: AutofillPageDetails | null | undefined,
): Set<AddressPart> {
  const form = field.form ?? null;
  const parts = new Set<AddressPart>();
  for (const f of pageDetails?.fields ?? []) {
    if ((f.form ?? null) !== form || f.viewable === false || f.type === "hidden") {
      continue;
    }
    const part = addressPartOf(f);
    if (part != null) {
      parts.add(part);
    }
  }
  return parts;
}

/**
 * Whether a field with no autocomplete hint is part of an address by its
 * name or label, in a form that asks for an address, so it gets the
 * identities' menu inside it.
 */
export function isAddressFieldByName(
  field: AutofillField,
  pageDetails: AutofillPageDetails | null | undefined,
): boolean {
  if (field.type === "password" || field.type === "search" || autofillHint(field) != null) {
    return false;
  }
  const part = addressPartByName(field);
  if (part == null) {
    return false;
  }
  const tag = tagOf(field);
  if (tag === "textarea" && part !== "street") {
    return false;
  }
  if (tag === "select" && part !== "state" && part !== "country") {
    return false;
  }
  return addressPartsInForm(field, pageDetails).size >= 3;
}

/**
 * Whether a text area is for the street, by its autocomplete hint or by the
 * rule above, so it gets the identities' menu though upstream's never opens
 * on a text area.
 */
export function isStreetTextArea(
  field: AutofillField,
  pageDetails: AutofillPageDetails | null | undefined,
): boolean {
  if (tagOf(field) !== "textarea") {
    return false;
  }
  const hint = autofillHint(field);
  if (hint != null) {
    return AUTOCOMPLETE_PARTS[hint] === "street";
  }
  return isAddressFieldByName(field, pageDetails);
}
