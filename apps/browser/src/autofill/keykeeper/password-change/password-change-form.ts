// Keykeeper: finding a page's change-password form, for assisted password
// change (DESIGN.md, "Assisted password change", "How it goes"). Generic
// mode: one form with a current-password field, a new-password field, and at
// most one confirm field, all visible password fields, and no other password
// field in that form. Which is which comes from the autocomplete tokens, then
// the field's own words, then the usual order. Pure: it reads the fields
// upstream's collection found (CollectAutofillContentService), so it's tested
// on its own (password-change-form.spec.ts).

import AutofillField from "../../models/autofill-field";
import { isOneTimeCodeField } from "../one-time-code-fields";

export type FieldRole = "current" | "new" | "confirm";

/** The change-password form found: field opids by role. */
export type ChangeFormPlan = {
  /** The form's opid, or null for fields outside any form. */
  form: string | null;
  current: string | null;
  new: string;
  confirm: string | null;
};

export type FormReading =
  /** One change-password form, and whether it also asks for a one-time code. */
  | { kind: "form"; plan: ChangeFormPlan; codeField: boolean }
  /** A form with a new password but no current one: maybe a sign-up form, or someone else's account. */
  | { kind: "noCurrent" }
  /** More than one form that could be it, or one whose fields can't be told apart. */
  | { kind: "ambiguous" }
  /** A sign-in form: a password that isn't new, with a username. */
  | { kind: "signIn" }
  | { kind: "none" };

const CURRENT_WORDS = ["current", "old", "existing", "present", "actual"];
const CONFIRM_WORDS = ["confirm", "confirmation", "repeat", "retype", "reenter", "again", "verify"];
const NEW_WORDS = ["new"];

/**
 * The field's own words: its id, name, label, placeholder, and title, split
 * into lowercase words. Not the text before it on the page (upstream's
 * "label-left"), which can be the previous field's label: the new-password
 * field would read as "current".
 */
function words(field: AutofillField): string[] {
  const values = [
    field.htmlID,
    field.htmlName,
    field.title,
    field.placeholder,
    field["label-tag"],
    field["label-aria"],
    field["label-data"],
  ];
  const found: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    // "newPassword", "new_password", "re-enter" and "re enter".
    const spaced = value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/re[-\s]enter/g, "reenter")
      .replace(/re[-\s]type/g, "retype");
    found.push(...spaced.split(/[^\p{L}\d]+/u).filter(Boolean));
  }
  return found;
}

const tokens = (field: AutofillField) =>
  (field.autoCompleteType ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** A password field a person could type in: masked, visible, enabled, and not read-only. */
export function isUsablePasswordField(field: AutofillField): boolean {
  return (
    field.type === "password" &&
    field.viewable === true &&
    field.disabled !== true &&
    field.readonly !== true &&
    field["aria-hidden"] !== true
  );
}

/** A field's role by what it says about itself, or null when it says nothing clear. */
export function roleOf(field: AutofillField): FieldRole | null {
  const t = tokens(field);
  const w = words(field);
  const has = (list: string[]) => w.some((word) => list.includes(word));
  if (t.includes("current-password")) {
    return "current";
  }
  if (t.includes("new-password")) {
    return has(CONFIRM_WORDS) ? "confirm" : "new";
  }
  if (has(CURRENT_WORDS)) {
    return "current";
  }
  if (has(CONFIRM_WORDS)) {
    return "confirm";
  }
  if (has(NEW_WORDS)) {
    return "new";
  }
  return null;
}

/**
 * The roles of one form's password fields, in page order, or null when they
 * aren't a current, a new, and at most one confirm. Three fields that say
 * nothing are taken in the usual order; two never are, since a new and a
 * confirm field look the same as a current and a new one.
 */
function rolesFor(fields: AutofillField[]): FieldRole[] | null {
  let roles = fields.map(roleOf);
  if (roles.every((r) => r == null) && fields.length === 3) {
    roles = ["current", "new", "confirm"];
  } else if (roles.some((r) => r == null)) {
    // Fill the gaps only where the order leaves no doubt: what's missing.
    const missing = (["current", "new", "confirm"] as FieldRole[]).filter(
      (r) => !roles.includes(r),
    );
    const gaps = roles.filter((r) => r == null).length;
    if (gaps !== missing.length || fields.length !== 3) {
      return null;
    }
    let next = 0;
    roles = roles.map((r) => r ?? missing[next++]);
  }
  const count = (role: FieldRole) => roles.filter((r) => r === role).length;
  if (count("new") !== 1 || count("current") > 1 || count("confirm") > 1) {
    return null;
  }
  return roles as FieldRole[];
}

const formKey = (field: AutofillField) => field.form ?? "";

/** Reads a page's fields for its change-password form. */
export function findChangePasswordForm(fields: AutofillField[]): FormReading {
  const groups = new Map<string, AutofillField[]>();
  for (const field of fields) {
    const key = formKey(field);
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }

  const candidates: { plan: ChangeFormPlan; codeField: boolean }[] = [];
  let noCurrent = false;
  let unclear = false;
  let signIn = false;
  for (const [key, group] of groups) {
    const passwords = group.filter(isUsablePasswordField);
    if (passwords.length === 0) {
      continue;
    }
    const codeField = group.some(
      (f) => f.viewable === true && (tokens(f).includes("one-time-code") || isOneTimeCodeField(f)),
    );
    if (passwords.length === 1) {
      const role = roleOf(passwords[0]);
      const hasUsername = group.some(
        (f) =>
          f.viewable === true &&
          (f.type === "text" || f.type === "email") &&
          (tokens(f).includes("username") || tokens(f).includes("email") || !isOneTimeCodeField(f)),
      );
      if (role === "new" || role === "confirm") {
        noCurrent = true;
      } else if (hasUsername) {
        signIn = true;
      }
      continue;
    }
    const roles = rolesFor(passwords);
    if (roles == null) {
      unclear = true;
      continue;
    }
    const opid = (role: FieldRole) => passwords[roles.indexOf(role)]?.opid ?? null;
    if (!roles.includes("current")) {
      noCurrent = true;
      continue;
    }
    candidates.push({
      plan: {
        form: key === "" ? null : key,
        current: opid("current"),
        new: opid("new")!,
        confirm: opid("confirm"),
      },
      codeField,
    });
  }

  if (candidates.length === 1 && !unclear && !noCurrent) {
    return { kind: "form", ...candidates[0] };
  }
  if (candidates.length > 1 || (candidates.length === 1 && (unclear || noCurrent)) || unclear) {
    return { kind: "ambiguous" };
  }
  if (noCurrent) {
    return { kind: "noCurrent" };
  }
  return signIn ? { kind: "signIn" } : { kind: "none" };
}
