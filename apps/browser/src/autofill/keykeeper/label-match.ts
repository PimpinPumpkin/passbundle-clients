// Keykeeper: a confident match between a page field's label and the name of
// one of an item's custom fields ("Customer number" and "Customer ID"), which
// the menu inside the field offers as one tap ("Fill Customer ID here?").
// Nothing fills on a match alone: the tap fills and saves a fill rule, through
// the fill picker's own code (fill-field-menu.ts). See DESIGN.md, "Choosing
// what fills where".
//
// What counts as confident, exactly:
//
// - Both are read as words: lower case, accents dropped, split at anything
//   that isn't a letter or digit and where a lower-case letter meets an upper
//   case one (customerId), with "#" read as a word of its own.
// - A few words mean the same: "id", "number", "no", "num", "nr", "nbr", and
//   "#" are all "number".
// - Words that only ask ("enter", "your", "please", "the", "a", "an", "my",
//   "here", "optional", "required") are left out.
// - What's left must be the same words on both sides (order and repeats
//   aside), and at least one of them must say what the value is: a label made
//   only of generic words ("Name", "Code", "ID", "Number", "Key", "Value")
//   never matches anything.
//
// This file has no imports beyond types, so the content script can use it too.

/** A page field's labels, as upstream's page details describe them. */
type Labeled = {
  "label-tag"?: string | null;
  "label-aria"?: string | null;
  placeholder?: string | null;
};

/** The label people see next to a field: its label element's text, else its aria label, else its placeholder. */
export function labelText(field: Labeled): string {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return text(field["label-tag"]) || text(field["label-aria"]) || text(field.placeholder);
}

/**
 * The same label with spaces collapsed, in lower case: the text a fill rule
 * records for a field (fill-rules.ts).
 */
export function shownLabel(field: Labeled): string {
  return labelText(field).replace(/\s+/g, " ").trim().toLowerCase();
}

const SAME_AS_NUMBER = new Set(["id", "number", "no", "num", "nr", "nbr"]);

const ONLY_ASKING = new Set([
  "a",
  "an",
  "the",
  "your",
  "my",
  "enter",
  "please",
  "here",
  "optional",
  "required",
]);

/** Words that don't say on their own what a value is. */
const GENERIC = new Set([
  "number",
  "name",
  "code",
  "key",
  "value",
  "text",
  "field",
  "info",
  "information",
  "data",
  "detail",
  "details",
  "other",
  "entry",
  "input",
]);

/** The words of a label or a custom field's name, as a match compares them. */
export function labelWords(text: string | null | undefined): string[] {
  const spaced = (text ?? "")
    .replace(/#/g, " number ")
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return spaced
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !ONLY_ASKING.has(word))
    .map((word) => (SAME_AS_NUMBER.has(word) ? "number" : word));
}

/** Whether a label has a word that says what its value is, not only generic ones. */
export function hasTellingWord(text: string | null | undefined): boolean {
  return labelWords(text).some((word) => !GENERIC.has(word));
}

/**
 * Whether a page field's label and a custom field's name are a confident
 * match: the same words, at least one of them telling.
 */
export function confidentLabelMatch(
  label: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const a = new Set(labelWords(label));
  const b = new Set(labelWords(name));
  if (a.size === 0 || a.size !== b.size || ![...a].every((word) => b.has(word))) {
    return false;
  }
  return [...a].some((word) => !GENERIC.has(word));
}
