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

export type FillSource =
  | { from: "username" }
  | { from: "password" }
  | { from: "totp" }
  | { from: "field"; name: string }
  | { from: "never" };

export type FillRule = {
  v: 1;
  /**
   * The host (with any port) of the page or frame the rule was made on. A rule
   * fills only there, so a rule on an item that matches several sites, or one
   * someone else with edit rights added, can't send a value anywhere else.
   */
  host?: string;
  field: FieldFingerprint;
  fill: FillSource;
};

type ItemFields = { fields?: { name?: string | null; value?: string | null }[] | null };

export function isFillRule(value: unknown): value is FillRule {
  const rule = value as FillRule;
  if (
    rule?.v !== 1 ||
    typeof rule.field !== "object" ||
    rule.field == null ||
    typeof rule.fill !== "object" ||
    rule.fill == null ||
    (rule.host != null && typeof rule.host !== "string")
  ) {
    return false;
  }
  const from = rule.fill.from;
  if (from === "field") {
    return typeof (rule.fill as { name?: unknown }).name === "string";
  }
  return from === "username" || from === "password" || from === "totp" || from === "never";
}

function parseRule(value: string | null | undefined): FillRule | null {
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
    const rule = parseRule(field.value);
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

/** Whether two rules are for the same field on the same host (an item keeps one of those). */
export const sameRuleTarget = (a: FillRule, b: FillRule) =>
  (a.host ?? null) === (b.host ?? null) && sameField(a.field, b.field);

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
    const stored = parseRule(field.value);
    return stored == null || !sameRuleTarget(stored, rule);
  }) as T["fields"];
  return item;
}

/** How a rule finds its field, in a few words. */
export function describeFingerprint(field: FieldFingerprint): string {
  if (field.id) {
    return `the field with id ${field.id}`;
  }
  if (field.name) {
    return `the field named ${field.name}`;
  }
  return `the field labeled "${field.label ?? ""}"`;
}

const SOURCES: Record<Exclude<FillSource["from"], "field">, string> = {
  username: "the username",
  password: "the password",
  totp: "the one-time code",
  never: "nothing (never fill)",
};

/** What a rule puts in its field, in a few words. */
export function describeSource(source: FillSource): string {
  return source.from === "field" ? `the ${source.name} field` : SOURCES[source.from];
}

/** A rule in plain language: where it applies, and what it does there. */
export function describeFillRule(rule: FillRule): { site: string; text: string } {
  return {
    site: rule.host || "Every site",
    text: `${describeFingerprint(rule.field)} gets ${describeSource(rule.fill)}`,
  };
}
