// Keykeeper item templates: an item type plus a set of starting custom fields,
// like 1Password's API key or server items. A new item records the template it
// came from in a text field named TEMPLATE_FIELD_NAME, so its template can be
// shown later; everything else is ordinary custom fields, which the server and
// other clients store and show like any other.
//
// Custom templates are items too: a secure note with a text field named
// TEMPLATE_DEFINITION_FIELD_NAME. The note's name is the template's name and
// its custom fields are the template's fields, values included as defaults, so
// people create, edit, share, and delete templates with the ordinary item
// editor, and a template in an organization's collection reaches everyone who
// can see that collection.
//
// An MSP sends its templates to its clients as copies with the same id, whose
// definition says they're copies ("from"). Anyone who can edit an item can
// write that, so nothing shown says who a template came from: templates are
// offered by where they are, and identical copies of one template in several
// organizations once. See DESIGN.md, "MSP templates", in the keykeeper repo.
//
// Typed fields (a date, a website, an email address, a phone number, a
// number, a one-time code) are ordinary text or hidden custom fields too: the
// template's definition says each one's type by its label ("types"), and
// which date field is a new item's expiration date ("expires"). An item made
// from a template gets the same in its marker, so its editor and view know
// them without the template. Other clients see plain custom fields. See
// DESIGN.md, "Item templates", "Typed fields".

import { newGuid } from "@bitwarden/guid";

import { CipherType, FieldType } from "../enums";
import { FieldView } from "../models/view/field.view";

import { isSecretField, maySeeSecrets } from "./hidden-secrets";
import { visibleCustomFields } from "./reserved-fields";

export const TEMPLATE_FIELD_NAME = "keykeeper.template";
export const TEMPLATE_DEFINITION_FIELD_NAME = "keykeeper.template-definition";

/** Upstream's three kinds of custom field, and the kinds a template can give one. */
export type TemplateFieldKind = "text" | "hidden" | "boolean" | TypedKind;

/**
 * The kinds a template gives a field beyond upstream's own. A one-time code
 * is a hidden field holding the key; the rest are text fields.
 */
export type TypedKind = "date" | "url" | "email" | "phone" | "number" | "totp";

export const TYPED_KINDS: readonly TypedKind[] = [
  "date",
  "url",
  "email",
  "phone",
  "number",
  "totp",
];

/** What editors call each kind. English until Keykeeper's own strings are translated. */
export const FIELD_KIND_NAMES: Readonly<Record<TemplateFieldKind, string>> = {
  text: "Text",
  hidden: "Hidden",
  boolean: "Checkbox",
  date: "Date",
  url: "Website",
  email: "Email",
  phone: "Phone",
  number: "Number",
  totp: "One-time code",
};

export type TemplateField = {
  label: string;
  kind: TemplateFieldKind;
  value?: string;
  /** A date field that is a new item's expiration date (DESIGN.md, "Expiration dates"). */
  expires?: true;
};

export type TemplateBase = "login" | "note";

export type ItemTemplate = {
  id: string;
  name: string;
  /** An icon from the component library's icon font. */
  icon: string;
  /** The item type it builds on: a login (username, password, website) or a note. */
  base: TemplateBase;
  fields: TemplateField[];
  /** For a custom template: the item that defines it, and its organization if any. */
  source?: { cipherId: string; organizationId: string | null };
  /** For a copy an MSP keeps up to date: what its definition says, never shown as who sent it. */
  copy?: boolean;
};

const text = (label: string): TemplateField => ({ label, kind: "text" });
const hidden = (label: string): TemplateField => ({ label, kind: "hidden" });
const yesNo = (label: string): TemplateField => ({ label, kind: "boolean" });
const typed = (label: string, kind: TypedKind): TemplateField => ({ label, kind });

// English until Keykeeper's own strings are translated.
export const BUILT_IN_TEMPLATES: readonly ItemTemplate[] = [
  {
    id: "api-key",
    name: "API key",
    icon: "bwi-key",
    base: "note",
    fields: [hidden("Key"), hidden("Secret"), typed("Service URL", "url"), text("Scopes")],
  },
  {
    id: "server",
    name: "Server",
    icon: "bwi-terminal",
    base: "login",
    fields: [text("Hostname"), typed("Port", "number"), text("Operating system")],
  },
  {
    id: "database",
    name: "Database",
    icon: "bwi-list-alt",
    base: "login",
    fields: [text("Type"), text("Hostname"), typed("Port", "number"), text("Database name")],
  },
  {
    id: "wifi",
    name: "Wi-Fi network",
    icon: "bwi-wireless",
    base: "note",
    fields: [text("Network name"), hidden("Password"), text("Security type")],
  },
  {
    id: "router",
    name: "Router",
    icon: "bwi-globe",
    base: "login",
    fields: [text("Network name"), hidden("Wi-Fi password")],
  },
  {
    id: "software-license",
    name: "Software license",
    icon: "bwi-file-text",
    base: "note",
    fields: [
      hidden("License key"),
      text("Licensed to"),
      text("Version"),
      typed("Purchase date", "date"),
    ],
  },
  {
    id: "domain",
    name: "Domain",
    icon: "bwi-globe",
    base: "login",
    fields: [text("Domain name"), text("Registrar"), yesNo("Auto-renew")],
  },
  {
    id: "certificate",
    name: "Certificate",
    icon: "bwi-lock",
    base: "note",
    fields: [text("Common name"), text("Issuer"), hidden("Private key")],
  },
  {
    id: "email-account",
    name: "Email account",
    icon: "bwi-envelope",
    base: "login",
    fields: [text("Incoming server"), text("Outgoing server"), typed("Port", "number")],
  },
  {
    id: "membership",
    name: "Membership",
    icon: "bwi-id-card",
    base: "note",
    fields: [text("Organization"), text("Member ID"), typed("Phone", "phone")],
  },
];

export function templateCipherType(template: Pick<ItemTemplate, "base">): CipherType {
  return template.base === "login" ? CipherType.Login : CipherType.SecureNote;
}

/** The custom field type a kind is kept as: a one-time code's key is hidden. */
export function storedFieldType(kind: TemplateFieldKind): FieldType {
  return kind === "hidden" || kind === "totp"
    ? FieldType.Hidden
    : kind === "boolean"
      ? FieldType.Boolean
      : FieldType.Text;
}

/**
 * A template's typed fields, by label, as its definition and the markers of
 * items made from it keep them: `types` (each typed field's kind) and
 * `expires` (the date field that is the item's expiration date).
 */
export type FieldTyping = { types: Readonly<Record<string, TypedKind>>; expires?: string };

const MAX_TYPED_FIELDS = 100;
const MAX_LABEL_LENGTH = 200;

const owns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * The typing in a definition's or a marker's JSON, only what's well formed:
 * a kind nobody knows is left out, so its field is what its own type says (a
 * newer kind is a text field to older apps), and `expires` counts only when
 * it names a date field.
 */
export function typingOf(json: Record<string, unknown> | null | undefined): FieldTyping {
  const types: Record<string, TypedKind> = {};
  const raw = json?.types;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [label, kind] of Object.entries(raw).slice(0, MAX_TYPED_FIELDS)) {
      if (
        label !== "" &&
        label !== "__proto__" &&
        label.length <= MAX_LABEL_LENGTH &&
        TYPED_KINDS.includes(kind as TypedKind)
      ) {
        types[label] = kind as TypedKind;
      }
    }
  }
  const expires = json?.expires;
  return typeof expires === "string" && owns(types, expires) && types[expires] === "date"
    ? { types, expires }
    : { types };
}

/** The typing of a template's fields: each typed one's kind, and the expiration date's. */
export function typingOfFields(fields: readonly TemplateField[]): FieldTyping {
  const types: Record<string, TypedKind> = {};
  let expires: string | undefined;
  for (const f of fields) {
    if (f.kind !== "text" && f.kind !== "hidden" && f.kind !== "boolean") {
      types[f.label] = f.kind;
      if (f.kind === "date" && f.expires && expires == null) {
        expires = f.label;
      }
    }
  }
  return typingOf(expires == null ? { types } : { types, expires });
}

/** The keys a definition or a marker keeps its typing in: none when there's nothing typed. */
function typingKeys(typing: FieldTyping): { types?: Record<string, TypedKind>; expires?: string } {
  const clean = typingOf(typing as unknown as Record<string, unknown>);
  if (Object.keys(clean.types).length === 0) {
    return {};
  }
  return clean.expires
    ? { types: { ...clean.types }, expires: clean.expires }
    : { types: { ...clean.types } };
}

/**
 * A definition's or a marker's value with this typing in place of what it
 * had, its other keys as they were; null when the value isn't one.
 */
export function withTyping(value: string | null | undefined, typing: FieldTyping): string | null {
  const json = parseJson(value);
  if (json == null) {
    return null;
  }
  const rest = { ...json };
  delete rest.types;
  delete rest.expires;
  return JSON.stringify({ ...rest, ...typingKeys(typing) });
}

/**
 * A field's kind: its own type, or the template's kind for it where that
 * fits its own type (a date, a website, an email address, a phone number, or
 * a number in a text field, a one-time code's key in a hidden one). Null for
 * a linked field.
 */
export function fieldKind(field: FieldLike, typing: FieldTyping): TemplateFieldKind | null {
  const own: TemplateFieldKind | null =
    field.type === FieldType.Hidden
      ? "hidden"
      : field.type === FieldType.Boolean
        ? "boolean"
        : field.type === FieldType.Text
          ? "text"
          : null;
  const name = field.name ?? "";
  const kind = own != null && owns(typing.types, name) ? typing.types[name] : undefined;
  return kind != null && storedFieldType(kind) === field.type ? kind : own;
}

/**
 * The typing that applies to an item's fields: a custom template's own
 * definition's, or else the marker's of the template the item came from.
 */
export function itemTyping(item: ItemLike): FieldTyping {
  const fields = item?.fields ?? [];
  if (templateDefinition(item) != null) {
    return typingOf(
      parseJson(fields.find((f) => f.name === TEMPLATE_DEFINITION_FIELD_NAME)?.value),
    );
  }
  const marker = parseJson(fields.find((f) => f.name === TEMPLATE_FIELD_NAME)?.value);
  return typeof marker?.id === "string" ? typingOf(marker) : { types: {} };
}

/**
 * The text field that holds an item's expiration date, as the template it
 * came from marks it, if it has one. A template itself has none: its date is
 * a default for new items. Expiration dates read it first ("Expiration
 * dates", expiration.ts).
 */
export function expirationFieldOf<F extends FieldLike>(item: { fields?: F[] | null }): F | null {
  if (templateDefinition(item) != null) {
    return null;
  }
  const label = itemTyping(item).expires;
  return label == null
    ? null
    : ((item.fields ?? []).find((f) => f.name === label && f.type === FieldType.Text) ?? null);
}

/** The starting custom fields for a new item from this template, marker included. */
export function templateFields(template: ItemTemplate): FieldView[] {
  const marker = new FieldView();
  marker.name = TEMPLATE_FIELD_NAME;
  marker.type = FieldType.Text;
  marker.value = JSON.stringify({
    id: template.id,
    name: template.name,
    v: 1,
    ...typingKeys(typingOfFields(template.fields)),
  });
  const fields = template.fields.map((f) => {
    const field = new FieldView();
    field.name = f.label;
    field.type = storedFieldType(f.kind);
    field.value = f.value ?? (f.kind === "boolean" ? "false" : "");
    return field;
  });
  return [...fields, marker];
}

type FieldLike = { name?: string | null; value?: string | null; type?: FieldType | null };
type ItemLike = { fields?: FieldLike[] | null } | null | undefined;

function parseJson(value: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function looksLikeWebAddress(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    // A bare host, like example.com or example.com/login.
    return /^[^/:@]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value);
  }
}

/**
 * What's wrong with a typed field's value, said plainly, or null. Editors
 * show it under the field as a warning: it never stops the item saving.
 * An empty field is fine.
 */
export function typedFieldProblem(
  kind: TemplateFieldKind | null | undefined,
  value: string | null | undefined,
): string | null {
  const v = (value ?? "").trim();
  if (v === "") {
    return null;
  }
  switch (kind) {
    case "date":
      return isIsoDate(v) ? null : "Write the date as year, month, and day, such as 2027-03-31.";
    case "url":
      return looksLikeWebAddress(v) ? null : "This doesn't look like a web address.";
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
        ? null
        : "This doesn't look like an email address.";
    case "phone":
      return /^\+?[\d\s().\-/]+$/.test(v) && (v.match(/\d/g) ?? []).length >= 3
        ? null
        : "This doesn't look like a phone number.";
    case "number":
      return /^[+-]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(v) ? null : "This isn't a number.";
    default:
      return null;
  }
}

const TEMPLATE_ID = /^[A-Za-z0-9-]{1,64}$/;
const BASE_ICONS: Record<TemplateBase, string> = { login: "bwi-globe", note: "bwi-sticky-note" };

/**
 * The definition field for a custom template; `from` names the MSP for a copy
 * it sends, and `typing` is its typed fields'.
 */
export function newTemplateDefinitionField(
  base: TemplateBase,
  id = newGuid(),
  from?: string,
  typing: FieldTyping = { types: {} },
): FieldView {
  const field = new FieldView();
  field.name = TEMPLATE_DEFINITION_FIELD_NAME;
  field.type = FieldType.Text;
  field.value = JSON.stringify({
    id,
    base,
    v: 1,
    ...(from ? { from } : {}),
    ...typingKeys(typing),
  });
  return field;
}

const MAX_FROM_LENGTH = 100;

/**
 * The id and base type of a custom template item, and the MSP it came from
 * for a copy an MSP sent, or null for any other item.
 */
export function templateDefinition(
  item: ItemLike,
): { id: string; base: TemplateBase; from?: string } | null {
  const definition = parseJson(
    (item?.fields ?? []).find((f) => f.name === TEMPLATE_DEFINITION_FIELD_NAME)?.value,
  );
  if (
    definition?.v !== 1 ||
    typeof definition.id !== "string" ||
    !TEMPLATE_ID.test(definition.id) ||
    (definition.base !== "login" && definition.base !== "note")
  ) {
    return null;
  }
  const from = typeof definition.from === "string" ? definition.from.trim() : "";
  return from && from.length <= MAX_FROM_LENGTH
    ? { id: definition.id, base: definition.base, from }
    : { id: definition.id, base: definition.base };
}

/**
 * Whether an item is a template copy an MSP keeps up to date in a client's
 * Templates collection. Every member of the client has one, and nobody edits
 * it, so vault lists show it only when that collection is open; the template
 * picker lists it as always. See DESIGN.md, "MSP templates".
 */
export function isMspTemplateCopy(item: ItemLike): boolean {
  return templateDefinition(item)?.from != null;
}

/**
 * Whether an item is one of the person's own templates or one of their
 * organizations', not a copy an MSP keeps up to date: what the Item
 * templates view lists, and the other lists leave out unless its folder or
 * shared folder is open (DESIGN.md, "Item templates").
 */
export function isOwnTemplate(item: ItemLike & { type?: unknown }): boolean {
  const definition = templateDefinition(item);
  return definition != null && definition.from == null && isNote(item);
}

/** A note, by a full view's type or a list view's ("secureNote"). */
function isNote(item: { type?: unknown }): boolean {
  return item.type === CipherType.SecureNote || item.type === "secureNote";
}

/**
 * The starting fields for a new custom template made from an item ("Save as
 * template"): its definition (logins for a login, notes otherwise) and the
 * item's own custom fields by label and kind, never their values, which belong
 * to that item. Kinds include the typed ones of the template the item came
 * from, and which date is its expiration date. The editor opens these as a
 * new note, so nothing is saved until the person saves it. Null for an item
 * that's already a template, or a kind of item templates don't cover.
 */
export function templateFieldsFromItem(item: {
  type?: CipherType | null;
  fields?: FieldLike[] | null;
}): FieldView[] | null {
  if (
    (item.type !== CipherType.Login && item.type !== CipherType.SecureNote) ||
    templateDefinition(item) != null
  ) {
    return null;
  }
  const typing = itemTyping(item);
  const kinds: TemplateField[] = [];
  const fields = visibleCustomFields(item.fields).flatMap((f): FieldView[] => {
    const kind = fieldKind(f, typing);
    if (kind == null) {
      return [];
    }
    const label = f.name ?? "";
    kinds.push(
      kind === "date" && typing.expires === label
        ? { label, kind, expires: true }
        : { label, kind },
    );
    const field = new FieldView();
    field.name = label;
    field.type = storedFieldType(kind);
    field.value = kind === "boolean" ? "false" : "";
    return [field];
  });
  return [
    ...fields,
    newTemplateDefinitionField(
      item.type === CipherType.Login ? "login" : "note",
      undefined,
      undefined,
      typingOfFields(kinds),
    ),
  ];
}

type TemplateItem = {
  id?: string | null;
  name?: string | null;
  type?: CipherType | null;
  organizationId?: string | null;
  deletedDate?: Date | null;
  fields?: FieldLike[] | null;
  viewPassword?: boolean | null;
};

/**
 * The custom template an item defines, or null if it isn't one. A hidden
 * field's default is a secret like any other: for someone who can't see the
 * template note's passwords (DESIGN.md, "Folders and permissions"), the field
 * comes without it, empty, as in the apps (core/src/templates.rs, `groups`).
 */
export function customTemplate(item: TemplateItem): ItemTemplate | null {
  const definition = templateDefinition(item);
  if (definition == null || item.type !== CipherType.SecureNote || item.deletedDate != null) {
    return null;
  }
  const seesSecrets = maySeeSecrets(item);
  const typing = itemTyping(item);
  const fields = visibleCustomFields(item.fields).flatMap((f): TemplateField[] => {
    const kind = fieldKind(f, typing);
    const value = isSecretField(f.type) && !seesSecrets ? undefined : (f.value ?? undefined);
    const label = f.name ?? "";
    if (kind == null) {
      return [];
    }
    return kind === "date" && typing.expires === label
      ? [{ label, kind, value, expires: true }]
      : [{ label, kind, value }];
  });
  return {
    id: definition.id,
    name: item.name?.trim() || "Untitled template",
    icon: BASE_ICONS[definition.base],
    base: definition.base,
    fields,
    source: { cipherId: item.id ?? "", organizationId: item.organizationId ?? null },
    ...(definition.from ? { copy: true } : {}),
  };
}

/** Every custom template among these items, by name. */
export function customTemplates(items: TemplateItem[]): ItemTemplate[] {
  return items
    .map(customTemplate)
    .filter((t): t is ItemTemplate => t != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type TemplateGroup = { name: string; templates: readonly ItemTemplate[] };

/** What a template gives a new item, to tell identical copies of it apart from different ones. */
const sameTemplate = (a: ItemTemplate, b: ItemTemplate) =>
  a.id === b.id &&
  a.name === b.name &&
  a.base === b.base &&
  JSON.stringify(a.fields) === JSON.stringify(b.fields);

/**
 * Templates to choose from, grouped by where they are: each organization's
 * (by organization name), then the person's own, then built-in. Who a
 * template came from isn't shown, since anyone who can edit an item could
 * claim to be anyone. A template an MSP copies into many clients is offered
 * once, however many of them the person sees: copies in other organizations
 * that are identical to one already offered (the MSP's own template, if the
 * person sees it, or the first copy) are left out. A copy that differs, such
 * as one someone changed, is offered where it is. Empty groups are left out.
 */
export function templateGroups(
  items: TemplateItem[],
  organizations: { id: string; name: string }[],
): TemplateGroup[] {
  const sorted = [...organizations].sort((a, b) => a.name.localeCompare(b.name));
  const order = (t: ItemTemplate) => {
    const at = sorted.findIndex((o) => o.id === t.source?.organizationId);
    return at < 0 ? sorted.length : at;
  };
  // Originals before copies, then by where they are, so the one offered is
  // the original when the person sees it.
  const all = customTemplates(items).sort(
    (a, b) => Number(a.copy ?? false) - Number(b.copy ?? false) || order(a) - order(b),
  );
  const offered: ItemTemplate[] = [];
  for (const t of all) {
    const twin = offered.find(
      (o) => o.source?.organizationId !== t.source?.organizationId && sameTemplate(o, t),
    );
    if (!(t.copy && twin != null)) {
      offered.push(t);
    }
  }
  const byName = (list: ItemTemplate[]) => list.sort((a, b) => a.name.localeCompare(b.name));
  const groups: TemplateGroup[] = sorted.map((org) => ({
    name: org.name,
    templates: byName(offered.filter((t) => t.source?.organizationId === org.id)),
  }));
  groups.push({
    name: "My templates",
    templates: byName(offered.filter((t) => t.source?.organizationId == null)),
  });
  return [
    ...groups.filter((g) => g.templates.length > 0),
    { name: "Built-in", templates: BUILT_IN_TEMPLATES },
  ];
}

/**
 * The template an item was created from, if any. A built-in template comes
 * with its icon; a custom one is known by the name recorded when the item was
 * created, so it shows even to people who can't see the template itself.
 */
export function templateOf(item: ItemLike): Pick<ItemTemplate, "id" | "name" | "icon"> | null {
  const marker = parseJson((item?.fields ?? []).find((f) => f.name === TEMPLATE_FIELD_NAME)?.value);
  if (marker == null || typeof marker.id !== "string") {
    return null;
  }
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === marker.id);
  if (builtIn) {
    return builtIn;
  }
  return typeof marker.name === "string" && marker.name.trim() !== ""
    ? { id: marker.id, name: marker.name.trim(), icon: "bwi-file-text" }
    : null;
}
