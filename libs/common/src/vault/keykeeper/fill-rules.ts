// Keykeeper fill rules as stored on an item, without anything that needs a
// page: reading them, saying what one does in plain language, and removing
// one. The browser extension fills with them (apps/browser/src/autofill/
// keykeeper/fill-rules.ts); the item view and editor show them. See
// DESIGN.md, "Choosing what fills where".

export const FILL_RULE_FIELD_NAME = "keykeeper.fill";

/** How a rule recognizes a field on a page. The first present key that matches wins. */
export type FieldFingerprint = {
  id?: string;
  name?: string;
  label?: string;
};

/**
 * A card's values a rule can fill, by the card's own property names. The
 * order is the picker's, and each one's place gives its menu key, so new
 * ones go at the end.
 */
export const CARD_FILL_VALUES = [
  "cardholderName",
  "number",
  "expMonth",
  "expYear",
  "code",
] as const;
export type CardFillValue = (typeof CARD_FILL_VALUES)[number];

/** An identity's values a rule can fill: its names, contact details, and address. As above. */
export const IDENTITY_FILL_VALUES = [
  "firstName",
  "middleName",
  "lastName",
  "fullName",
  "company",
  "email",
  "phone",
  "address1",
  "address2",
  "address3",
  "city",
  "state",
  "postalCode",
  "country",
] as const;
export type IdentityFillValue = (typeof IDENTITY_FILL_VALUES)[number];

export type FillSource =
  | { from: "username" }
  | { from: "password" }
  | { from: "totp" }
  | { from: "field"; name: string }
  | { from: "card"; value: CardFillValue }
  | { from: "identity"; value: IdentityFillValue }
  | { from: "never" };

export type FillRule = {
  v: 1;
  /**
   * The host (with any port) of the page or frame the rule was made on. A rule
   * fills only there, so a rule on an item that matches several sites, or one
   * someone else with edit rights added, can't send a value anywhere else.
   */
  host?: string;
  /**
   * The page's scheme, "https" when left out: a rule fills only on that
   * scheme, so an http:// copy of the site never gets a rule's value.
   */
  scheme?: RuleScheme;
  field: FieldFingerprint;
  fill: FillSource;
};

export type RuleScheme = "http" | "https";

/** The scheme a rule fills on: the one it records, https when it records none. */
export const schemeOf = (rule: Pick<FillRule, "scheme">): RuleScheme => rule.scheme ?? "https";

type ItemFields = { fields?: { name?: string | null; value?: string | null }[] | null };

export function isFillRule(value: unknown): value is FillRule {
  const rule = value as FillRule;
  if (
    rule?.v !== 1 ||
    typeof rule.field !== "object" ||
    rule.field == null ||
    typeof rule.fill !== "object" ||
    rule.fill == null ||
    (rule.host != null && typeof rule.host !== "string") ||
    (rule.scheme != null && rule.scheme !== "http" && rule.scheme !== "https")
  ) {
    return false;
  }
  const from = rule.fill.from;
  if (from === "field") {
    return typeof (rule.fill as { name?: unknown }).name === "string";
  }
  // A card's or an identity's value only by a name this app knows: one added
  // later is left alone, as a rule this app can't read.
  if (from === "card") {
    return (CARD_FILL_VALUES as readonly unknown[]).includes(
      (rule.fill as { value?: unknown }).value,
    );
  }
  if (from === "identity") {
    return (IDENTITY_FILL_VALUES as readonly unknown[]).includes(
      (rule.fill as { value?: unknown }).value,
    );
  }
  return from === "username" || from === "password" || from === "totp" || from === "never";
}

/** A stored rule, or null when the value isn't one. */
export function parseFillRule(value: string | null | undefined): FillRule | null {
  try {
    const parsed = JSON.parse(value ?? "");
    return isFillRule(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The fill rules stored on an item. Anything unreadable is ignored. */
export function readFillRules(item: ItemFields | null | undefined): FillRule[] {
  const rules: FillRule[] = [];
  for (const field of item?.fields ?? []) {
    if (field.name !== FILL_RULE_FIELD_NAME || !field.value) {
      continue;
    }
    const rule = parseFillRule(field.value);
    if (rule) {
      rules.push(rule);
    }
  }
  return rules;
}

export const sameField = (a: FieldFingerprint, b: FieldFingerprint) =>
  (a.id ?? null) === (b.id ?? null) &&
  (a.name ?? null) === (b.name ?? null) &&
  (a.label ?? null) === (b.label ?? null);

/** Whether two rules are for the same field on the same site (an item keeps one of those). */
export const sameRuleTarget = (a: FillRule, b: FillRule) =>
  (a.host ?? null) === (b.host ?? null) &&
  schemeOf(a) === schemeOf(b) &&
  sameField(a.field, b.field);

/**
 * Removes a rule from an item: the stored rule for the same field on the same
 * host. Everything else on the item, including rules it can't read, stays.
 * The caller saves the item.
 */
export function removeFillRule<T extends ItemFields>(item: T, rule: FillRule): T {
  item.fields = (item.fields ?? []).filter((field) => {
    if (field.name !== FILL_RULE_FIELD_NAME) {
      return true;
    }
    const stored = parseFillRule(field.value);
    return stored == null || !sameRuleTarget(stored, rule);
  }) as T["fields"];
  return item;
}

/**
 * The words rules are described in, by message key, with the placeholders'
 * values in order: Keykeeper's own (brand/messages.en.json), and upstream's
 * names for an item's values, which come translated. Here in English for a
 * build without our strings, and for tests.
 */
const ENGLISH: Record<string, string> = {
  keykeeperFillRuleEverySite: "Every site",
  keykeeperFillRuleFieldWithId: "the field with id $1",
  keykeeperFillRuleFieldNamed: "the field named $1",
  keykeeperFillRuleFieldLabeled: 'the field labeled "$1"',
  keykeeperFillRuleGets: "$1 gets $2",
  keykeeperFillRuleCustomField: "the $1 field",
  keykeeperFillRuleCardValue: "the card's $1",
  keykeeperFillRuleIdentityValue: "the identity's $1",
  keykeeperFillRuleNothing: "nothing (never fill)",
  keykeeperFillRuleFieldMissing: "$1, which this item doesn't have",
  keykeeperFillRules: "Fill rules",
  keykeeperFillRulesMadeWith: 'Made with "Fill this field with" in the browser extension.',
  keykeeperFillRulesEditToRemove: "Edit the item to remove one.",
  keykeeperRemoveFillRule: "Remove the rule: $1, $2",
  username: "Username",
  password: "Password",
  verificationCode: "Verification code",
  cardholderName: "Cardholder name",
  number: "Number",
  expirationMonth: "Expiration month",
  expirationYear: "Expiration year",
  securityCode: "Security code",
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  fullName: "Full name",
  company: "Company",
  email: "Email",
  phone: "Phone",
  address1: "Address 1",
  address2: "Address 2",
  address3: "Address 3",
  cityTown: "City / Town",
  stateProvince: "State / Province",
  zipPostalCode: "Zip / Postal code",
  country: "Country",
};

/** Upstream's name for each of a card's values, by message key. */
export const CARD_VALUE_WORDS: Record<CardFillValue, string> = {
  cardholderName: "cardholderName",
  number: "number",
  expMonth: "expirationMonth",
  expYear: "expirationYear",
  code: "securityCode",
};

/** Upstream's name for each of an identity's values, by message key. */
export const IDENTITY_VALUE_WORDS: Record<IdentityFillValue, string> = {
  firstName: "firstName",
  middleName: "middleName",
  lastName: "lastName",
  fullName: "fullName",
  company: "company",
  email: "email",
  phone: "phone",
  address1: "address1",
  address2: "address2",
  address3: "address3",
  city: "cityTown",
  state: "stateProvince",
  postalCode: "zipPostalCode",
  country: "country",
};

/** Gives a message by key, with its placeholders filled in order (I18nService.t). */
export type FillRuleWords = (key: string, ...values: string[]) => string;

/** The words in English. */
export const englishFillRuleWords: FillRuleWords = (key, ...values) =>
  (ENGLISH[key] ?? key).replace(/\$(\d)/g, (_, n: string) => values[Number(n) - 1] ?? "");

/**
 * The words in the person's language, English for any message that isn't
 * translated yet (or, in a build without Keykeeper's strings, missing).
 */
export function fillRuleWords(i18n: {
  t: (key: string, ...values: string[]) => string;
}): FillRuleWords {
  return (key, ...values) => i18n.t(key, ...values) || englishFillRuleWords(key, ...values);
}

/** How a rule finds its field, in a few words. */
export function describeFingerprint(
  field: FieldFingerprint,
  words: FillRuleWords = englishFillRuleWords,
): string {
  if (field.id) {
    return words("keykeeperFillRuleFieldWithId", field.id);
  }
  if (field.name) {
    return words("keykeeperFillRuleFieldNamed", field.name);
  }
  return words("keykeeperFillRuleFieldLabeled", field.label ?? "");
}

/** What a rule puts in its field, in a few words. */
export function describeSource(
  source: FillSource,
  words: FillRuleWords = englishFillRuleWords,
): string {
  switch (source.from) {
    case "field":
      return words("keykeeperFillRuleCustomField", source.name);
    case "card":
      return words("keykeeperFillRuleCardValue", words(CARD_VALUE_WORDS[source.value]));
    case "identity":
      return words("keykeeperFillRuleIdentityValue", words(IDENTITY_VALUE_WORDS[source.value]));
    case "username":
      return words("username");
    case "password":
      return words("password");
    case "totp":
      return words("verificationCode");
    default:
      return words("keykeeperFillRuleNothing");
  }
}

/** Where a rule applies, as the lists show it: its host, or "Every site". */
export function describeSite(
  rule: Pick<FillRule, "host" | "scheme">,
  words: FillRuleWords = englishFillRuleWords,
): string {
  if (!rule.host) {
    return words("keykeeperFillRuleEverySite");
  }
  return schemeOf(rule) === "http" ? `http://${rule.host}` : rule.host;
}

/** A rule in plain language: where it applies, and what it does there. */
export function describeFillRule(
  rule: FillRule,
  words: FillRuleWords = englishFillRuleWords,
): { site: string; text: string } {
  return {
    site: describeSite(rule, words),
    text: words(
      "keykeeperFillRuleGets",
      describeFingerprint(rule.field, words),
      describeSource(rule.fill, words),
    ),
  };
}
