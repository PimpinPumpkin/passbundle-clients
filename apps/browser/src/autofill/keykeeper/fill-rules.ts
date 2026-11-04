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
  parseFillRule,
  readFillRules,
  RuleScheme,
  sameRuleTarget,
  schemeOf,
} from "@bitwarden/common/vault/keykeeper/fill-rules";
import {
  isSecretCustomField,
  isSecretValue,
  maySeeSecrets,
} from "@bitwarden/common/vault/keykeeper/hidden-secrets";
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

/** A page's scheme when it's one rules fill on (http or https), or null. */
export function schemeOfUrl(url: string | null | undefined): RuleScheme | null {
  try {
    const protocol = new URL(url ?? "").protocol;
    return protocol === "https:" ? "https" : protocol === "http:" ? "http" : null;
  } catch {
    return null;
  }
}

/** Whether a rule made for a site applies on the page at `url`: the same scheme and host. */
export function ruleAppliesOn(rule: FillRule, url: string | null | undefined): boolean {
  const host = hostOf(url);
  return rule.host != null && host !== "" && rule.host === host && schemeOf(rule) === schemeOfUrl(url);
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
 * Whether a source is something the item can hide, by the shared allowlist
 * (hidden-secrets.ts): the password, a verification code, a hidden custom
 * field, or a linked one that fills a secret.
 */
export function isSecretSource(cipher: CipherView, source: FillSource): boolean {
  switch (source.from) {
    case "username":
      return isSecretValue("login.username");
    case "password":
      return isSecretValue("login.password");
    case "totp":
      return isSecretValue("login.totp");
    // A rule names a field by its name; if a secret field shares it, it counts as one.
    case "field":
      return visibleCustomFields(cipher).some(
        (f) => f.name === source.name && isSecretCustomField(cipher, f),
      );
    default:
      return false;
  }
}

/**
 * Whether a value may go into this field, as far as seeing it goes: for
 * someone who can't see the item's passwords, a secret only into a password
 * field, where they can't read it either. One-time codes are the exception:
 * they last seconds, and the fields they go in are text fields. Rules and the
 * item's custom fields (autofill.service.ts) both ask this.
 */
export function mayFillValue(
  cipher: CipherView,
  source: FillSource,
  field: AutofillField,
): boolean {
  const hidden = source.from !== "totp" && isSecretSource(cipher, source);
  return !hidden || maySeeSecrets(cipher) || field.type === "password";
}

/**
 * Whether a rule may fill this field. Never into a field the person can't
 * see, and a secret as `mayFillValue` allows.
 */
export function mayFill(cipher: CipherView, source: FillSource, field: AutofillField): boolean {
  if (!field.viewable || field.type === "hidden") {
    return false;
  }
  return mayFillValue(cipher, source, field);
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
    const existing = parseFillRule(field.value);
    return existing == null || !sameRuleTarget(existing, rule);
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
 * Site fixes (site-fixes.ts): rules that apply to everyone on the server for a
 * site, and sharing a rule someone made. The extension's background fills
 * these in; until then there are none.
 */
export const keykeeperSiteFixes = {
  rulesFor: async (_url: string): Promise<FillRule[]> => [],
  share: async (_rule: FillRule): Promise<void> => {},
};

/** How a fill was started, and upstream's limits for it, which rules keep too. */
export type FillRuleOptions = {
  /**
   * The person started this fill (the popup, the inline menu, a shortcut, the
   * context menu), not autofill on page load. Site fixes apply only then.
   */
  userStarted: boolean;
  /** Upstream's onlyEmptyFields (page load): a field that has a value keeps it. */
  onlyEmptyFields: boolean;
  /** Upstream's skipUsernameOnlyFill (page load): no username on a page without a password field. */
  skipUsernameOnlyFill: boolean;
  /** Upstream's allowTotpAutofill and canAccessTotp, together: whether a one-time code may fill. */
  allowTotp: boolean;
  /**
   * Upstream's exclusions (AutofillService.isExcludedFromFillRules): search
   * boxes, captchas, "forgot" fields, newsletter forms, and the field types
   * autofill never fills.
   */
  excluded: (field: AutofillField, pageDetails: AutofillPageDetails) => boolean;
};

/** A rule, and whether it came from the server (a site fix) rather than the item. */
type AppliedRule = { rule: FillRule; fix: boolean };

/**
 * Whether a rule's value may go into this field on this fill. On top of
 * `mayFill`: upstream's exclusions and page-load limits, and for a site fix,
 * a password only into a password field, whoever it fills for, since anyone
 * who runs the server (or a few accounts on it) can publish one.
 */
function mayApply(
  cipher: CipherView,
  { rule, fix }: AppliedRule,
  field: AutofillField,
  pageDetails: AutofillPageDetails,
  options: FillRuleOptions,
): boolean {
  const from = rule.fill.from;
  if (options.excluded(field, pageDetails) || !mayFill(cipher, rule.fill, field)) {
    return false;
  }
  if (fix && from === "password" && field.type !== "password") {
    return false;
  }
  if (options.onlyEmptyFields && (field.value ?? "").trim() !== "") {
    return false;
  }
  if (from === "totp" && !options.allowTotp) {
    return false;
  }
  if (
    from === "username" &&
    options.skipUsernameOnlyFill &&
    !pageDetails.fields.some((f) => f.type === "password" && f.viewable)
  ) {
    return false;
  }
  return true;
}

/**
 * Applies an item's fill rules, then any site fixes for the page, to a fill
 * script, before upstream's own matching runs. Only rules made on this page's
 * scheme and host apply; a never rule from before rules had a host applies
 * anywhere, since it only holds a value back. Site fixes apply only to a fill
 * the person started, never on page load. Value rules fill their field, within
 * upstream's limits for the fill (`FillRuleOptions`). Never rules claim their
 * field without filling it. Fields claimed here are added to `filledFields`,
 * which upstream's matching skips. Returns the never-fill fields' opids, which
 * the caller also hides from upstream's field selection, so a password meant
 * for a never-fill field goes to the next fitting field instead of nowhere.
 */
export async function applyFillRules(
  cipher: CipherView,
  pageDetails: AutofillPageDetails,
  fillScript: AutofillScript,
  filledFields: { [opid: string]: AutofillField },
  valueFor: (source: FillSource) => Promise<string | null>,
  fill: (fillScript: AutofillScript, field: AutofillField, value: string) => void,
  options: FillRuleOptions,
): Promise<Set<string>> {
  const neverFill = new Set<string>();
  const applies = (r: FillRule) =>
    r.host == null ? r.fill.from === "never" : ruleAppliesOn(r, pageDetails.url);
  // The item's own rules first, then site fixes for this site: a field the
  // item has a rule for is the item's.
  const fixes = options.userStarted ? await keykeeperSiteFixes.rulesFor(pageDetails.url) : [];
  const rules: AppliedRule[] = [
    ...readFillRules(cipher).map((rule) => ({ rule, fix: false })),
    ...fixes.map((rule) => ({ rule, fix: true })),
  ].filter(({ rule }) => applies(rule));
  if (!rules.length) {
    return neverFill;
  }
  for (const field of pageDetails.fields) {
    if (field.opid == null || Object.prototype.hasOwnProperty.call(filledFields, field.opid)) {
      continue;
    }
    const applied = rules.find(({ rule }) => fieldMatches(rule.field, field));
    if (!applied) {
      continue;
    }
    if (applied.rule.fill.from === "never") {
      filledFields[field.opid] = field;
      neverFill.add(field.opid);
      continue;
    }
    if (!mayApply(cipher, applied, field, pageDetails, options)) {
      continue;
    }
    const value = await valueFor(applied.rule.fill);
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
