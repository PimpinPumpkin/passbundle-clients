// Keykeeper: "See passwords" in the command-line tool (DESIGN.md, "Folders and
// permissions", in the meta repo). Someone who can open an item in a shared
// folder without "see passwords" gets its plain values only, from every
// command and from `serve` alike: the shared allowlist in
// libs/common/src/vault/keykeeper/hidden-secrets.ts decides what's plain, so a
// value of a new kind stays hidden until someone says it's plain. Only an item
// that says yes (`viewPassword` true) shows its secrets.
//
// Editing such an item keeps its secrets as they are: the editor in the web
// vault and the extension locks them. A secret sent back empty (as `get item`
// shows it) is kept; a request that carries any value for one is refused,
// whatever the value, so an edit can't be used to check guesses of it (a
// right guess would otherwise save, and a wrong one be refused).

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
  // The item's own key, wrapped, as upstream's output has it: an edit sends it
  // back, and saving without it would drop it.
  shown.key = item.key;
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

type Values = Record<string, unknown>;
type Request = {
  type?: unknown;
  login?: { fido2Credentials?: unknown[] | null } | null;
  fields?: { name?: string | null; type?: FieldView["type"]; value?: string | null }[] | null;
  [part: string]: unknown;
};

const refusal = (what: string, keep = "") =>
  `You can't see this item's passwords, so you can't ${what}.${keep ? " " + keep : ""}`;
const leaveEmpty = () =>
  `Leave it empty, as \`${CLI_BRAND.command} get item\` shows it, to keep it as it is.`;

/**
 * Before an edit of an item whose secrets the person can't see is read: says
 * why it's refused if the request (as the script sent it) carries a value for
 * any secret, or changes the item's type; null otherwise, and always for
 * someone who can see the secrets. Run on the request itself, before anything
 * fills in the item's own values.
 */
export function refuseSentSecrets(original: CipherView, request: Request): string | null {
  if (maySeeSecrets(original)) {
    return null;
  }
  if (request.type !== original.type) {
    return refusal("change its type");
  }
  for (const [part, properties] of Object.entries(ITEM_VALUES)) {
    const sent = request[part];
    if (sent == null || typeof sent !== "object") {
      continue;
    }
    for (const property of properties) {
      if (isSecretValue(`${part}.${property}`) && !blank((sent as Values)[property])) {
        return refusal(`change its ${property}`, leaveEmpty());
      }
    }
  }
  if ((request.login?.fido2Credentials ?? []).length > 0) {
    return refusal("change its passkeys", "Leave them out to keep them.");
  }
  for (const field of request.fields ?? []) {
    if (field == null || !isSecretCustomField(original, field) || blank(field.value)) {
      continue;
    }
    const known = (original.fields ?? []).some(
      (f) => f.name === field.name && f.type === field.type && isSecretCustomField(original, f),
    );
    return known
      ? refusal(`change the hidden field "${field.name ?? ""}"`, leaveEmpty())
      : refusal(`add a hidden field ("${field.name ?? ""}") or link a field to a secret`);
  }
  return null;
}

/**
 * Before an edit is read: an SSH key's private key that a script sent back
 * empty, as `get item` showed it, is the item's own again, since reading the
 * request needs one. Run after `refuseSentSecrets`.
 */
export function fillHiddenSshKey(original: CipherView, request: { sshKey?: unknown }): void {
  const sshKey = request.sshKey as Values | null | undefined;
  if (
    !maySeeSecrets(original) &&
    sshKey != null &&
    typeof sshKey === "object" &&
    blank(sshKey.privateKey)
  ) {
    sshKey.privateKey = original.sshKey?.privateKey;
  }
}

/** An item's secrets as they were before an edit, for `keepHiddenSecrets`. */
export type HiddenSecrets = {
  type: CipherView["type"];
  key: CipherView["key"];
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
    const partValues = (item as unknown as Record<string, Values | null>)[part];
    for (const property of properties) {
      if (partValues != null && isSecretValue(`${part}.${property}`)) {
        values.push({ part, property, value: partValues[property] });
      }
    }
  }
  return {
    type: item.type,
    key: item.key,
    values,
    passkeys: item.login?.fido2Credentials,
    passwordHistory: item.passwordHistory,
    fields: (item.fields ?? [])
      .filter((f) => isSecretCustomField(item, f))
      .map((f) => ({ name: f.name, type: f.type, value: f.value, linkedId: f.linkedId })),
  };
}

/**
 * After an edit of an item whose secrets the person can't see is read onto
 * it (`kept` from `hiddenSecretsOf` before, and `refuseSentSecrets` passed):
 * puts every secret back as it was in `edited`, keeps the item's own key if
 * the request had none, and says why the edit is refused if it adds a hidden
 * field (or a field linked to a secret) or removes one. Null when the edit may
 * go ahead, which is always for someone who can see the secrets.
 */
export function keepHiddenSecrets(kept: HiddenSecrets | null, edited: CipherView): string | null {
  if (kept == null) {
    return null;
  }
  if (edited.type !== kept.type) {
    return refusal("change its type");
  }
  if (edited.key == null) {
    edited.key = kept.key;
  }

  // Each kind's own values: password, one-time code, card number, and the rest.
  for (const { part, property, value } of kept.values) {
    const after = (edited as unknown as Record<string, Values | null>)[part];
    if (after != null) {
      after[property] = value;
    }
  }
  // Passkeys and earlier passwords, as they were.
  if (edited.login != null) {
    edited.login.fido2Credentials = kept.passkeys;
  }
  edited.passwordHistory = kept.passwordHistory;

  // Hidden fields and linked fields that fill a secret: each one the item has
  // must come back by name and kind, and none may be added.
  const unmatched = [...kept.fields];
  for (const field of edited.fields ?? []) {
    if (!isSecretCustomField(edited, field)) {
      continue;
    }
    const i = unmatched.findIndex((f) => f.name === field.name && f.type === field.type);
    if (i < 0) {
      return refusal(`add a hidden field ("${field.name ?? ""}") or link a field to a secret`);
    }
    const [was] = unmatched.splice(i, 1);
    field.value = was.value;
    field.linkedId = was.linkedId;
  }
  if (unmatched.length > 0) {
    return refusal(`remove the hidden field "${unmatched[0].name ?? ""}"`);
  }
  return null;
}
