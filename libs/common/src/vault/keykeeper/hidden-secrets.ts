// Keykeeper: what someone without "see passwords" in an item's shared
// folders may never reveal or copy (DESIGN.md, "Folders and permissions").
// The server sends the whole item, since autofill needs it, so the apps keep
// these hidden on every path: the item's page, copy buttons, menus, keyboard
// shortcuts, the fill menu inside websites, password history, version
// history, and the editor. Filling them into a website still works.

import { FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";

/** The mask shown in place of a hidden value, so the value isn't in the page at all. */
export const HIDDEN_VALUE_MASK = "••••••••";

/**
 * The secrets "see passwords" covers, as copy actions name them: the
 * password, the one-time code (its secret and its codes), a card's number and
 * security code, an SSH key's private key, and hidden custom fields.
 */
export const HIDDEN_SECRET_ACTIONS: ReadonlySet<string> = new Set([
  "password",
  "totp",
  "cardNumber",
  "securityCode",
  "privateKey",
  "hiddenField",
]);

/** An item, as far as seeing its secrets goes: upstream's `viewPassword`. */
export type SecretsLike = { viewPassword?: boolean | null };

/**
 * Whether the person may see and copy the item's secrets. Only an explicit
 * no hides them: the person's own items, and items from a server that doesn't
 * say, keep upstream's default.
 */
export function maySeeSecrets(item: SecretsLike | null | undefined): boolean {
  return item?.viewPassword !== false;
}

/** Whether copying this kind of value from the item is allowed. */
export function mayCopy(item: SecretsLike | null | undefined, action: string): boolean {
  return maySeeSecrets(item) || !HIDDEN_SECRET_ACTIONS.has(action);
}

/** A secret as the page may show it: the value, or the mask when it's hidden. */
export function shownSecret(
  item: SecretsLike | null | undefined,
  value: string | null | undefined,
): string {
  if (!value) {
    return "";
  }
  return maySeeSecrets(item) ? value : HIDDEN_VALUE_MASK;
}

/**
 * Takes every secret "see passwords" covers out of an item: for a copy made
 * from an item whose secrets the person can't see (a clone, from any page
 * that offers one), so the copy, which would be theirs, can't carry them:
 * the password and its history, the one-time code's secret, a card's number
 * and code, an SSH key's private key, hidden fields' values, and passkeys.
 */
export function clearHiddenSecrets(cipher: CipherView): void {
  if (cipher.login != null) {
    cipher.login.password = undefined;
    cipher.login.totp = undefined;
    cipher.login.fido2Credentials = [];
  }
  if (cipher.card != null) {
    cipher.card.number = undefined;
    cipher.card.code = undefined;
  }
  if (cipher.sshKey != null) {
    cipher.sshKey.privateKey = "";
  }
  for (const field of cipher.fields ?? []) {
    if (field.type === FieldType.Hidden) {
      field.value = undefined;
    }
  }
  cipher.passwordHistory = [];
}
