// Keykeeper: assisted password change (DESIGN.md, "Assisted password change").
// The browser extension changes a login's password on its site: it saves the
// new password to the item first, then fills in the site's form and presses
// its button. This is the part the extension's background, its popup, and the
// web vault share: who may start one, and the marker an unfinished change
// leaves on the item, so every device can ask "Did the new password work?"
// and put the old password back with one click.

import { CipherType, FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { LoginView } from "../models/view/login.view";

import { openAndFillUrl, OpenAndFillWebsite } from "./open-and-fill";

/**
 * The marker's field. A text field, not a hidden one: upstream's save adds a
 * hidden field's old value to password history whenever it changes, which
 * would fill that with markers. Nothing in it is secret.
 */
export const PASSWORD_CHANGE_FIELD_NAME = "keykeeper.password-change";

/**
 * pending: the new password is saved and the result isn't known yet (or the
 * change stopped partway). refused: the site said no. unsure: the site said
 * nothing PassBundle could read either way.
 */
export type PasswordChangeState = "pending" | "refused" | "unsure";

export type PasswordChangeMarker = {
  v: 1;
  state: PasswordChangeState;
  /** The site's host, as the person sees it. */
  site: string;
  /** When the new password was saved, as an ISO date: just before the save. */
  at: string;
};

/**
 * How long after the marker's time the password's revision date may be and
 * still be the change's own. Any other change of the password moves the date
 * past it.
 */
export const PASSWORD_CHANGE_WINDOW_MS = 2 * 60_000;
/** Clocks and rounding: the revision date may read a little before the marker's time. */
const EARLY_MS = 1_000;

const STATES: ReadonlySet<string> = new Set(["pending", "refused", "unsure"]);
const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/;

type FieldLike = { name?: string | null; value?: string | null };
type ItemLike = {
  type?: CipherType;
  fields?: FieldLike[] | null;
  login?: {
    password?: string | null;
    passwordRevisionDate?: Date | string | null;
    uris?: OpenAndFillWebsite[] | null;
  } | null;
  passwordHistory?: { password?: string | null; lastUsedDate?: Date | string | null }[] | null;
};

const time = (value: Date | string | null | undefined): number | null => {
  if (value == null) {
    return null;
  }
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** The marker as stored, if it reads cleanly. Says nothing about whether it still counts. */
export function readPasswordChangeMarker(
  item: ItemLike | null | undefined,
): PasswordChangeMarker | null {
  const value = (item?.fields ?? []).find((f) => f.name === PASSWORD_CHANGE_FIELD_NAME)?.value;
  if (typeof value !== "string" || value.length > 1000) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const m = parsed as Partial<PasswordChangeMarker> | null;
  if (
    m == null ||
    m.v !== 1 ||
    typeof m.state !== "string" ||
    !STATES.has(m.state) ||
    typeof m.site !== "string" ||
    !HOST.test(m.site) ||
    typeof m.at !== "string" ||
    time(m.at) == null
  ) {
    return null;
  }
  return { v: 1, state: m.state as PasswordChangeState, site: m.site, at: m.at };
}

/**
 * The item's unfinished change: its marker, while the item's password is
 * still the one the change saved (its revision date just after the marker's
 * time). A password changed any other way since (by hand, by restoring a
 * version, in another app) ends it, and the marker is ignored.
 */
export function unfinishedPasswordChange(
  item: ItemLike | null | undefined,
): PasswordChangeMarker | null {
  const marker = readPasswordChangeMarker(item);
  if (marker == null || item?.type !== CipherType.Login) {
    return null;
  }
  const at = time(marker.at)!;
  const revised = time(item.login?.passwordRevisionDate);
  if (revised == null || revised < at - EARLY_MS || revised > at + PASSWORD_CHANGE_WINDOW_MS) {
    return null;
  }
  return marker;
}

/**
 * The password the item had before its unfinished change: the password
 * history entry the change made, which upstream's save records at the same
 * moment it sets the password's revision date. Null when there's no such
 * entry (it was saved by an app that keeps no history, say).
 */
export function passwordBeforeChange(item: ItemLike | null | undefined): string | null {
  if (unfinishedPasswordChange(item) == null) {
    return null;
  }
  const revised = time(item!.login!.passwordRevisionDate)!;
  let best: { password: string; distance: number } | null = null;
  for (const entry of item!.passwordHistory ?? []) {
    const used = time(entry.lastUsedDate);
    if (used == null || typeof entry.password !== "string" || entry.password === "") {
      continue;
    }
    const distance = Math.abs(used - revised);
    if (distance <= PASSWORD_CHANGE_WINDOW_MS && (best == null || distance < best.distance)) {
      best = { password: entry.password, distance };
    }
  }
  return best != null && best.password !== item!.login!.password ? best.password : null;
}

/** A marker for a change saved now. */
export function newPasswordChangeMarker(site: string, now: Date): PasswordChangeMarker {
  return { v: 1, state: "pending", site: site.toLowerCase(), at: now.toISOString() };
}

/** The item's fields with the marker set, replaced, or (null) taken off. */
export function fieldsWithMarker<T extends FieldLike>(
  fields: T[] | null | undefined,
  marker: PasswordChangeMarker | null,
): (T | FieldView)[] {
  const others: (T | FieldView)[] = (fields ?? []).filter(
    (f) => f.name !== PASSWORD_CHANGE_FIELD_NAME,
  );
  if (marker == null) {
    return others;
  }
  const field = new FieldView();
  field.name = PASSWORD_CHANGE_FIELD_NAME;
  field.type = FieldType.Text;
  field.value = JSON.stringify(marker);
  return [...others, field];
}

/**
 * A copy of the item to save, with its own login, fields, and password
 * history, so a failed save leaves the cached item as it was.
 */
export function editableCopy(item: CipherView): CipherView {
  const copy: CipherView = Object.assign(new CipherView(), item);
  if (item.login != null) {
    copy.login = Object.assign(new LoginView(), item.login);
  }
  copy.fields = [...(item.fields ?? [])];
  copy.passwordHistory =
    item.passwordHistory == null ? item.passwordHistory : [...item.passwordHistory];
  return copy;
}

/** The item with a new password and the marker of a change saved now. The caller saves it. */
export function withNewPassword(
  item: CipherView,
  password: string,
  site: string,
  now: Date,
): CipherView {
  const copy = editableCopy(item);
  copy.login.password = password;
  copy.fields = fieldsWithMarker(copy.fields, newPasswordChangeMarker(site, now)) as FieldView[];
  return copy;
}

/** The item with its marker in a new state (the result came in). The caller saves it. */
export function withChangeState(item: CipherView, state: PasswordChangeState): CipherView | null {
  const marker = unfinishedPasswordChange(item);
  if (marker == null) {
    return null;
  }
  const copy = editableCopy(item);
  copy.fields = fieldsWithMarker(copy.fields, { ...marker, state }) as FieldView[];
  return copy;
}

/** "It worked": the item as it is, without the marker. The caller saves it. */
export function withChangeConfirmed(item: CipherView): CipherView {
  const copy = editableCopy(item);
  copy.fields = fieldsWithMarker(copy.fields, null) as FieldView[];
  return copy;
}

/**
 * "Put the old password back": the item with the password it had before the
 * change, without the marker. Saving it keeps the new password in password
 * history in turn, so both stay in the item. Null when there's nothing to put
 * back.
 */
export function withOldPasswordBack(item: CipherView): CipherView | null {
  const old = passwordBeforeChange(item);
  if (old == null) {
    return null;
  }
  const copy = withChangeConfirmed(item);
  copy.login.password = old;
  return copy;
}

/** The first of a login's websites a change can start from: one that fills, over https. */
export function passwordChangeWebsite(
  websites: OpenAndFillWebsite[] | null | undefined,
): string | null {
  for (const website of websites ?? []) {
    const url = openAndFillUrl(website);
    if (url != null && url.startsWith("https://")) {
      return url;
    }
  }
  return null;
}

/** What decides whether someone may start a change on an item. */
export type PasswordChangeItem = ItemLike & {
  id?: string | null;
  organizationId?: string | null;
  edit?: boolean;
  viewPassword?: boolean;
  isDeleted?: boolean;
};

/**
 * Whether the person may start an assisted password change on the item: a
 * login they can edit and see the password of (for an organization's item,
 * its folder permissions decide both), with a password saved, a website it
 * can start from over https, and not in the trash. An organization's item
 * also needs the organization to allow it (`organizationAllows`), which none
 * does yet: see DESIGN.md, "Organizations".
 */
export function mayChangePassword(
  item: PasswordChangeItem | null | undefined,
  organizationAllows: (organizationId: string) => boolean = () => false,
): boolean {
  if (
    item == null ||
    item.type !== CipherType.Login ||
    item.isDeleted === true ||
    item.edit !== true ||
    item.viewPassword !== true ||
    typeof item.login?.password !== "string" ||
    item.login.password === "" ||
    passwordChangeWebsite(item.login.uris) == null
  ) {
    return false;
  }
  return item.organizationId == null || organizationAllows(item.organizationId);
}

/**
 * Organizations that allow assisted password change on their items. None yet:
 * the switch is a setting of PassBundle's own that isn't built (DESIGN.md,
 * "Organizations"), and organization items wait for it.
 */
export const organizationAllowsPasswordChange = (_organizationId: string): boolean => false;
