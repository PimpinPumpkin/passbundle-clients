// Keykeeper keeps its own data on items as hidden custom fields named
// "keykeeper.<something>": fill rules now, expiration dates and template data
// next. They stay encrypted and sync like any field, and the server and other
// clients need no changes. People never see or edit them as custom fields, and
// editors must keep them intact when an item is saved.

export const KEYKEEPER_FIELD_PREFIX = "keykeeper.";

export function isKeykeeperField(field: { name?: string | null }): boolean {
  return (field.name ?? "").startsWith(KEYKEEPER_FIELD_PREFIX);
}

/**
 * Whether a name a person gives a custom field is one of Keykeeper's own,
 * which they may not give: such a field would turn into Keykeeper's data (a
 * template definition, say) and leave the editor. Any case, any spaces around.
 */
export function isReservedFieldName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase().startsWith(KEYKEEPER_FIELD_PREFIX);
}

/** The custom fields a person sees and edits. */
export function visibleCustomFields<T extends { name?: string | null }>(fields?: T[] | null): T[] {
  return (fields ?? []).filter((field) => !isKeykeeperField(field));
}

/** Keykeeper's own fields, to carry through an edit unchanged. */
export function keykeeperFields<T extends { name?: string | null }>(fields?: T[] | null): T[] {
  return (fields ?? []).filter(isKeykeeperField);
}
