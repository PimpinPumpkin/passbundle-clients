// Keykeeper: an import never plants PassBundle's own fields. Our data on an
// item lives in hidden custom fields named "keykeeper.<something>" (fill
// rules, template markers, expiration dates; see reserved-fields.ts in
// @bitwarden/common), which the apps trust: a fill rule fills, and a template
// definition that says it's an MSP's copy hides the item from vault lists
// while it still fills. A crafted export could carry such fields.
//
// - From another password manager, or a browser: nothing there is ours, so a
//   field with one of our names keeps its value under a visible name.
// - From our own .json export (plain or password-protected): our fields come
//   back only when they're well formed, rewritten from what was read, and a
//   template definition never comes back as an MSP's copy. Anything else
//   under our names keeps its value under a visible name.

import { FieldType } from "@bitwarden/common/vault/enums";
import { EXPIRES_FIELD_NAME, parseIsoDate } from "@bitwarden/common/vault/keykeeper/expiration";
import {
  FILL_RULE_FIELD_NAME,
  FillRule,
  FillSource,
  parseFillRule,
} from "@bitwarden/common/vault/keykeeper/fill-rules";
import { isReservedFieldName } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import {
  TEMPLATE_DEFINITION_FIELD_NAME,
  TEMPLATE_FIELD_NAME,
  templateDefinition,
} from "@bitwarden/common/vault/keykeeper/templates";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { ImportResult } from "../../models/import-result";

/** Where an import comes from: our own .json export, or anything else. */
export type ImportSource = "ours" | "other";

/** The visible name a field with one of our names gets. */
export function visibleName(name: string | null | undefined): string {
  return `Imported ${(name ?? "").trim()}`;
}

const TEMPLATE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_TEXT = 200;

/** A short piece of page text, with no line breaks or other control characters. */
const text = (value: unknown): string | undefined =>
  typeof value === "string" &&
  value.length <= MAX_TEXT &&
  ![...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
    ? value
    : undefined;

/** A fill rule rewritten from only what a rule has, or null when it isn't one. */
function wellFormedRule(value: string | null | undefined): FillRule | null {
  const parsed = parseFillRule(value);
  if (parsed == null) {
    return null;
  }
  const field: FillRule["field"] = {};
  for (const key of ["id", "name", "label"] as const) {
    const part = text(parsed.field[key]);
    if (part) {
      field[key] = part;
    }
  }
  if (Object.keys(field).length === 0) {
    return null;
  }
  let fill: FillSource;
  if (parsed.fill.from === "field") {
    const name = text(parsed.fill.name);
    if (!name || isReservedFieldName(name)) {
      return null;
    }
    fill = { from: "field", name };
  } else {
    fill = { from: parsed.fill.from };
  }
  const host = parsed.host?.toLowerCase();
  if (host != null && !/^[a-z0-9.:[\]-]{1,253}$/.test(host)) {
    return null;
  }
  // In the order the extension writes them.
  return {
    v: 1,
    ...(host != null ? { host } : {}),
    ...(parsed.scheme != null ? { scheme: parsed.scheme } : {}),
    field,
    fill,
  };
}

/** A template marker rewritten from its id and name, or null. */
function wellFormedMarker(value: string | null | undefined): string | null {
  try {
    const marker = JSON.parse(value ?? "");
    const name = text(marker?.name);
    if (typeof marker?.id !== "string" || !TEMPLATE_ID.test(marker.id) || !name) {
      return null;
    }
    return JSON.stringify({ id: marker.id, name, v: 1 });
  } catch {
    return null;
  }
}

/** One of our fields as it may come back from our own export, or null. */
function wellFormed(field: FieldView, seen: Set<string>): string | null {
  const name = field.name ?? "";
  switch (name) {
    case FILL_RULE_FIELD_NAME: {
      const rule = field.type === FieldType.Hidden ? wellFormedRule(field.value) : null;
      return rule ? JSON.stringify(rule) : null;
    }
    case EXPIRES_FIELD_NAME:
      return !seen.has(name) && parseIsoDate(field.value) ? field.value : null;
    case TEMPLATE_FIELD_NAME:
      return !seen.has(name) ? wellFormedMarker(field.value) : null;
    case TEMPLATE_DEFINITION_FIELD_NAME: {
      // Never as an MSP's copy: that comes only from the MSP keeping it current.
      const definition = !seen.has(name) ? templateDefinition({ fields: [field] }) : null;
      return definition ? JSON.stringify({ id: definition.id, base: definition.base, v: 1 }) : null;
    }
    default:
      return null;
  }
}

/**
 * Makes an import's items safe to keep: our fields only where they're ours
 * and well formed, everything else under our names kept, visibly.
 */
export function guardReservedFields(result: ImportResult, source: ImportSource): void {
  for (const cipher of result.ciphers ?? []) {
    const seen = new Set<string>();
    for (const field of cipher.fields ?? []) {
      if (!isReservedFieldName(field.name)) {
        continue;
      }
      const value = source === "ours" ? wellFormed(field, seen) : null;
      if (value != null) {
        seen.add(field.name ?? "");
        field.value = value;
        continue;
      }
      field.name = visibleName(field.name);
    }
  }
}
