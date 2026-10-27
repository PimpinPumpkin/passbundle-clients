// Keykeeper: "See passwords" in the command-line tool (DESIGN.md, "Folders and
// permissions", in the meta repo). Someone who can open an item in a shared
// folder without "see passwords" gets its plain values only, from every
// command and from `serve` alike: the shared allowlist in
// libs/common/src/vault/keykeeper/hidden-secrets.ts decides what's plain, so a
// value of a new kind stays hidden until someone says it's plain. Only an item
// that says yes (`viewPassword` true) shows its secrets.
//
// Editing such an item keeps its secrets as they are: the editor in the web
// vault and the extension locks them, so the tool refuses a change to one, and
// a secret a script sent back empty (as it got it) is kept.

import {
  isSecretCustomField,
  isSecretValue,
  ITEM_VALUES,
  maySeeSecrets,
  plainItem,
} from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { CLI_BRAND } from "./brand";

/** Why a secret isn't there, for `get password`, `get totp`, and `get exposed`. */
export const HIDDEN_SECRETS_MESSAGE =
  "You can't see this item's passwords: the shared folder it's in lets you use them, not see them.";

/**
 * The item as someone who can't see its secrets gets it: its plain values,
 * what it is and where it lives, its dates, and its attachments' names.
 * Hidden fields and linked fields that fill a secret stay listed, by name and
 * kind, without a value, so a script can tell they're there and an edit keeps
 * them. Never a secret, a passkey, or password history.
 */
export function itemWithoutSecrets(item: CipherView): CipherView {
  const shown = plainItem(item);
  shown.id = item.id;
  shown.revisionDate = item.revisionDate;
  shown.creationDate = item.creationDate;
  shown.deletedDate = item.deletedDate;
  shown.archivedDate = item.archivedDate;
  shown.attachments = item.attachments;
  shown.passwordHistory = [];
  shown.fields = (item.fields ?? []).map((field) => {
    const copy = new FieldView();
    copy.name = field.name;
    copy.type = field.type;
    copy.linkedId = field.linkedId;
    copy.value = isSecretCustomField(item, field) ? undefined : field.value;
    return copy;
  });
  return shown;
}

/** The item as a command shows it: all of it, or its plain values only. */
export function shownItem(item: CipherView): CipherView {
  return maySeeSecrets(item) ? item : itemWithoutSecrets(item);
}

const blank = (value: unknown) => value == null || value === "";

/**
 * Before an edit is read: an SSH key's private key that a script sent back
 * empty, as `get item` showed it, is the item's own again, since reading the
 * request needs one. `keepHiddenSecrets` checks the rest afterwards.
 */
export function fillHiddenSshKey(
  original: CipherView,
  request: { sshKey?: { privateKey?: string } | null },
): void {
  if (!maySeeSecrets(original) && request.sshKey != null && blank(request.sshKey.privateKey)) {
    request.sshKey.privateKey = original.sshKey?.privateKey;
  }
}

/** An item's secrets as they were before an edit, for `keepHiddenSecrets`. */
export type HiddenSecrets = {
  type: CipherView["type"];
  values: { part: string; property: string; value: unknown }[];
  passkeys: CipherView["login"]["fido2Credentials"];
  passwordHistory: CipherView["passwordHistory"];
  fields: {
    name?: string;
    type: FieldView["type"];
    value?: string;
    linkedId?: FieldView["linkedId"];
  }[];
};

/**
 * A copy of the item's secrets, taken before an edit changes the item in
 * place; null for someone who can see them, whose edits aren't limited.
 */
export function hiddenSecretsOf(item: CipherView): HiddenSecrets | null {
  if (maySeeSecrets(item)) {
    return null;
  }
  const values: HiddenSecrets["values"] = [];
  for (const [part, properties] of Object.entries(ITEM_VALUES)) {
    const values_ = (item as unknown as Record<string, Record<string, unknown> | null>)[part];
    for (const property of properties) {
      if (values_ != null && isSecretValue(`${part}.${property}`)) {
        values.push({ part, property, value: values_[property] });
      }
    }
  }
  return {
    type: item.type,
    values,
    passkeys: item.login?.fido2Credentials,
    passwordHistory: item.passwordHistory,
    fields: (item.fields ?? [])
      .filter((f) => isSecretCustomField(item, f))
      .map((f) => ({ name: f.name, type: f.type, value: f.value, linkedId: f.linkedId })),
  };
}

/**
 * For an edit of an item whose secrets the person can't see (`kept`, from
 * `hiddenSecretsOf` before the edit): puts every secret back as it was in
 * `edited` (the item with the person's changes), and says why the edit is
 * refused if it changes, clears, adds, or removes one. A secret sent back
 * empty, as `get item` shows it, counts as unchanged. Returns null when the
 * edit may go ahead, which is always for someone who can see the secrets.
 */
export function keepHiddenSecrets(kept: HiddenSecrets | null, edited: CipherView): string | null {
  if (kept == null) {
    return null;
  }
  const refuse = (what: string, keep = "") =>
    `You can't see this item's passwords, so you can't ${what}.${keep ? " " + keep : ""}`;
  const leaveEmpty = `Leave it empty, as \`${CLI_BRAND.command} get item\` shows it, to keep it.`;

  if (edited.type !== kept.type) {
    return refuse("change its type");
  }

  // Each kind's own values: password, one-time code, card number, and the rest.
  for (const { part, property, value } of kept.values) {
    const after = (edited as unknown as Record<string, Record<string, unknown> | null>)[part];
    if (after == null) {
      continue;
    }
    if (!blank(after[property]) && after[property] !== value) {
      return refuse(`change its ${property}`, leaveEmpty);
    }
    after[property] = value;
  }

  // Passkeys are never shown, so an edit can't carry one: the item's stay.
  if (edited.login != null) {
    if ((edited.login.fido2Credentials ?? []).length > 0) {
      return refuse("change its passkeys", "Leave them out to keep them.");
    }
    edited.login.fido2Credentials = kept.passkeys;
  }

  // Earlier passwords are a secret too, kept as they are.
  edited.passwordHistory = kept.passwordHistory;

  // Hidden fields and linked fields that fill a secret: each one the item has
  // must come back by name and kind, empty or unchanged, and none may be added.
  const unmatched = [...kept.fields];
  for (const field of edited.fields ?? []) {
    if (!isSecretCustomField(edited, field)) {
      continue;
    }
    const i = unmatched.findIndex((f) => f.name === field.name && f.type === field.type);
    if (i < 0) {
      return refuse(`add a hidden field ("${field.name ?? ""}") or link a field to a secret`);
    }
    const [was] = unmatched.splice(i, 1);
    if (!blank(field.value) && field.value !== was.value) {
      return refuse(`change the hidden field "${field.name ?? ""}"`, leaveEmpty);
    }
    field.value = was.value;
    field.linkedId = was.linkedId;
  }
  if (unmatched.length > 0) {
    return refuse(`remove the hidden field "${unmatched[0].name ?? ""}"`);
  }
  return null;
}
