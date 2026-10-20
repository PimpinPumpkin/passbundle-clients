// Keykeeper fill rules: "fill this field with that value" and "never fill this
// field", chosen by the user and stored inside the item, so they are encrypted
// like the rest of the item and sync to every device.
//
// A rule is a hidden custom field named FILL_RULE_FIELD_NAME whose value is a
// small JSON document. Using a custom field keeps the server and other clients
// compatible: they store and sync it like any other field.

import { FieldType } from "@bitwarden/common/vault/enums";
import {
  FieldFingerprint,
  FILL_RULE_FIELD_NAME,
  FillRule,
  FillSource,
  isFillRule,
  readFillRules,
  sameField,
} from "@bitwarden/common/vault/keykeeper/fill-rules";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import AutofillScript from "../models/autofill-script";

// The stored form lives in @bitwarden/common, so the item view and editor can
// show rules too.
export { FILL_RULE_FIELD_NAME, readFillRules };
export type { FieldFingerprint, FillRule, FillSource };

/** A page's host, with any port, or "" for a page without one. */
export function hostOf(url: string | null | undefined): string {
  try {
    return new URL(url ?? "").host.toLowerCase();
  } catch {
    return "";
  }
}

const normalize = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The label people see next to the field, as the page describes it. */
function fieldLabel(field: AutofillField): string {
  return normalize(field["label-tag"] || field["label-aria"] || field.placeholder || "");
}

/** Builds a fingerprint for a field on a page, from its most stable attributes. */
export function fingerprintField(field: AutofillField): FieldFingerprint {
  const fingerprint: FieldFingerprint = {};
  if (field.htmlID) {
    fingerprint.id = field.htmlID;
  }
  if (field.htmlName) {
    fingerprint.name = field.htmlName;
  }
  const label = fieldLabel(field);
  if (label) {
    fingerprint.label = label;
  }
  return fingerprint;
}

/**
 * Whether a field on a page is the one a rule describes. The id decides when
 * the rule has one, then the name, then the visible label: a field without
 * the rule's id or name is never matched by its label alone.
 */
export function fieldMatches(fingerprint: FieldFingerprint, field: AutofillField): boolean {
  if (fingerprint.id) {
    return fingerprint.id === field.htmlID;
  }
  if (fingerprint.name) {
    return fingerprint.name === field.htmlName;
  }
  if (fingerprint.label) {
    return fingerprint.label === fieldLabel(field);
  }
  return false;
}

/**
 * Whether a source is something the item can hide: the password, a
 * verification code, or a hidden custom field.
 */
export function isSecretSource(cipher: CipherView, source: FillSource): boolean {
  switch (source.from) {
    case "password":
    case "totp":
      return true;
    case "field":
      return (
        visibleCustomFields(cipher).find((f) => f.name === source.name)?.type === FieldType.Hidden
      );
    default:
      return false;
  }
}

/**
 * Whether a rule may fill this field. Never into a field the person can't
 * see, and for someone who can't see the item's passwords, a password or
 * hidden field only into a password field, where they can't read it either.
 */
function mayFill(cipher: CipherView, source: FillSource, field: AutofillField): boolean {
  if (!field.viewable || field.type === "hidden") {
    return false;
  }
  const hidden =
    source.from === "password" || (source.from === "field" && isSecretSource(cipher, source));
  return !hidden || cipher.viewPassword || field.type === "password";
}

/**
 * Adds a rule to an item, replacing any existing rule for the same field on
 * the same host. The caller saves the item.
 */
export function upsertFillRule(cipher: CipherView, rule: FillRule): void {
  const others = (cipher.fields ?? []).filter((field) => {
    if (field.name !== FILL_RULE_FIELD_NAME) {
      return true;
    }
    try {
      const existing = JSON.parse(field.value ?? "");
      return !(
        isFillRule(existing) &&
        (existing.host ?? null) === (rule.host ?? null) &&
        sameField(existing.field, rule.field)
      );
    } catch {
      return true;
    }
  });
  const ruleField = new FieldView();
  ruleField.name = FILL_RULE_FIELD_NAME;
  ruleField.type = FieldType.Hidden;
  ruleField.value = JSON.stringify(rule);
  cipher.fields = [...others, ruleField];
}

/** The custom fields a person sees on an item, without any of Keykeeper's own fields. */
export function visibleCustomFields(cipher: CipherView): FieldView[] {
  return (cipher.fields ?? []).filter((field) => !(field.name ?? "").startsWith("keykeeper."));
}

/**
 * Applies an item's fill rules, then any site fixes for the page, to a fill
 * script, before upstream's own matching runs. Only rules made on this page's
 * host apply; a never rule from
 * before rules had a host applies anywhere, since it only holds a value back.
 * Value rules fill their field. Never rules claim their field
 * without filling it. Fields claimed here are added to `filledFields`, which
 * upstream's matching skips. Returns the never-fill fields' opids, which the
 * caller also hides from upstream's field selection, so a password meant for
 * a never-fill field goes to the next fitting field instead of nowhere.
 */
/**
 * Site fixes (site-fixes.ts): rules that apply to everyone on the server for a
 * site, and sharing a rule someone made. The extension's background fills
 * these in; until then there are none.
 */
export const keykeeperSiteFixes = {
  rulesFor: async (_url: string): Promise<FillRule[]> => [],
  share: async (_rule: FillRule): Promise<void> => {},
};

export async function applyFillRules(
  cipher: CipherView,
  pageDetails: AutofillPageDetails,
  fillScript: AutofillScript,
  filledFields: { [opid: string]: AutofillField },
  valueFor: (source: FillSource) => Promise<string | null>,
  fill: (fillScript: AutofillScript, field: AutofillField, value: string) => void,
): Promise<Set<string>> {
  const neverFill = new Set<string>();
  const host = hostOf(pageDetails.url);
  // The item's own rules first, then site fixes for this host: a field the
  // item has a rule for is the item's.
  const rules = [
    ...readFillRules(cipher),
    ...(await keykeeperSiteFixes.rulesFor(pageDetails.url)),
  ].filter((r) => (r.host == null ? r.fill.from === "never" : r.host === host && host !== ""));
  if (!rules.length) {
    return neverFill;
  }
  for (const field of pageDetails.fields) {
    if (field.opid == null || Object.prototype.hasOwnProperty.call(filledFields, field.opid)) {
      continue;
    }
    const rule = rules.find((r) => fieldMatches(r.field, field));
    if (!rule) {
      continue;
    }
    if (rule.fill.from === "never") {
      filledFields[field.opid] = field;
      neverFill.add(field.opid);
      continue;
    }
    if (!mayFill(cipher, rule.fill, field)) {
      continue;
    }
    const value = await valueFor(rule.fill);
    if (value == null || value === "") {
      continue;
    }
    filledFields[field.opid] = field;
    fill(fillScript, field, value);
  }
  return neverFill;
}

/** The plain value for a source on an item, without the TOTP code (async elsewhere). */
export function staticValueFor(cipher: CipherView, source: FillSource): string | null {
  switch (source.from) {
    case "username":
      return cipher.login?.username ?? null;
    case "password":
      return cipher.login?.password ?? null;
    case "field":
      return visibleCustomFields(cipher).find((f) => f.name === source.name)?.value ?? null;
    default:
      return null;
  }
}
