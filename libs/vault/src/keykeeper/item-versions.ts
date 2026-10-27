// Keykeeper: an item's past versions (DESIGN.md, "Item history"). The server
// keeps each version encrypted as it was stored and returns them for anyone
// who can open the item; apps decrypt them like the item, compare them field
// by field, and restore one by saving it as a normal edit.

import { formatDate } from "@angular/common";

import {
  FolderLike,
  gridOf,
  ItemLike,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { CipherRepromptType, CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { EXPIRES_FIELD_NAME } from "@bitwarden/common/vault/keykeeper/expiration";
import { isSecretField, isSecretValue } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { visibleCustomFields } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { Fido2CredentialView } from "@bitwarden/common/vault/models/view/fido2-credential.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

/** Who saved a version, as the server lets the caller see them. */
export type VersionEditor = { id: string | null; name: string | null; email: string | null };

/** GET /api/keykeeper/ciphers/<id>/history. */
export type ItemHistoryResponse = {
  object: "keykeeperCipherHistory";
  cipherId: string;
  revisionDate: string;
  /** Who saved the item as it is now. */
  savedBy: VersionEditor | null;
  /** The caller can't see the item's passwords: versions come without their fields. */
  hidePasswords: boolean;
  /** Newest first. */
  data: {
    object: "keykeeperCipherVersion";
    id: string;
    revisionDate: string;
    savedBy: VersionEditor | null;
    replacedDate: string;
    replacedBy: VersionEditor | null;
    /** The version as an item response, to decrypt like any item; null without its passwords. */
    cipher: unknown;
  }[];
};

/**
 * A version's time as history shows it, "Oct 27, 2026, 1:15 AM", as in the
 * apps. Angular's "medium" adds the seconds, and draws the narrow space it puts
 * before AM as none at all in our font.
 */
export const VERSION_TIME_FORMAT = "MMM d, y, h:mm a";

/** A version's time, in `VERSION_TIME_FORMAT`. */
export function versionTime(date: Date | string | number, locale: string): string {
  return formatDate(date, VERSION_TIME_FORMAT, locale);
}

export const historyPath = (cipherId: string) => `/keykeeper/ciphers/${cipherId}/history`;
export const versionPath = (cipherId: string, versionId: string) =>
  `${historyPath(cipherId)}/${versionId}`;

/**
 * What someone may do with an item's history, as the server decides
 * (passbundle-server, keykeeper_cipher_history.rs): see it at all (view item
 * history in one of the item's shared folders), read its versions' contents
 * (view item history and see passwords in the same one), and clear it or
 * delete a version (view item history and delete in the same one). Each pair
 * needs both in one way to the item, never one from each of two folders.
 */
export type HistoryAccess = { view: boolean; contents: boolean; clear: boolean };

/**
 * The person's history access to an item: everything with their own item;
 * with an organization's, from their capabilities in each of its shared
 * folders they reach (from sync, where each folder's grid already includes
 * access to every folder). `fullAccess` is for someone who reaches every
 * item of the organization (an owner or admin): the server gives them a way
 * to every item with every capability these need, whatever their own
 * folders say.
 */
export function historyAccess(
  item: ItemLike,
  folders: FolderLike[],
  fullAccess = false,
): HistoryAccess {
  if (item.organizationId == null || fullAccess) {
    return { view: true, contents: true, clear: true };
  }
  const ids = new Set(item.collectionIds ?? []);
  const ways = folders
    .filter((f) => f.organizationId === item.organizationId && ids.has(f.id))
    .map((f) => gridOf(f))
    .filter((g) => g.viewHistory);
  return {
    view: ways.length > 0,
    contents: ways.some((g) => g.seePasswords),
    clear: ways.some((g) => g.delete),
  };
}

/** A translator, like I18nService.t. */
export type Translate = (key: string, ...args: (string | number)[]) => string;

/** "Saved by you", "Saved by Ana", "Saved by another member", or nothing when nobody is recorded. */
export function savedByLabel(
  editor: VersionEditor | null | undefined,
  me: string | null | undefined,
  t: Translate,
): string | null {
  if (editor == null) {
    return null;
  }
  if (editor.id != null && editor.id === me) {
    return t("keykeeperSavedByYou");
  }
  const who = editor.name || editor.email;
  return who ? t("keykeeperSavedBy", who) : t("keykeeperSavedByAnotherMember");
}

/** One field of an item, as the version view compares it. */
type Entry = {
  key: string;
  label: string;
  value: string;
  /** What decides "changed", when the shown value isn't enough (passkeys). */
  compare?: string;
  /** Hidden until shown, and never shown to someone who can't see passwords. */
  secret?: boolean;
};

/** A row of the side-by-side view: this version's value and the item's now. */
export type VersionRow = {
  key: string;
  label: string;
  version: string;
  current: string;
  secret: boolean;
  changed: boolean;
};

const text = (value: unknown): string => (value == null ? "" : String(value));

function typeLabel(type: CipherType, t: Translate): string {
  switch (type) {
    case CipherType.Login:
      return t("typeLogin");
    case CipherType.SecureNote:
      return t("typeSecureNote");
    case CipherType.Card:
      return t("typeCard");
    case CipherType.Identity:
      return t("typeIdentity");
    case CipherType.SshKey:
      return t("typeSshKey");
    default:
      return String(type);
  }
}

/**
 * A type's part of an item: [property, label key]. Which are secrets is the
 * shared rule's (hidden-secrets.ts), as everywhere else.
 */
type Spec = [string, string];

const IDENTITY: Spec[] = [
  ["title", "title"],
  ["firstName", "firstName"],
  ["middleName", "middleName"],
  ["lastName", "lastName"],
  ["username", "username"],
  ["company", "company"],
  ["ssn", "ssn"],
  ["passportNumber", "passportNumber"],
  ["licenseNumber", "licenseNumber"],
  ["email", "email"],
  ["phone", "phone"],
  ["address1", "address1"],
  ["address2", "address2"],
  ["address3", "address3"],
  ["city", "cityTown"],
  ["state", "stateProvince"],
  ["postalCode", "zipPostalCodeLabel"],
  ["country", "country"],
];
const SSH_KEY: Spec[] = [
  ["privateKey", "sshPrivateKey"],
  ["publicKey", "sshPublicKey"],
  ["keyFingerprint", "sshFingerprint"],
];
const BANK_ACCOUNT: Spec[] = [
  ["bankName", "bankName"],
  ["nameOnAccount", "nameOnAccount"],
  ["accountType", "bankAccountType"],
  ["accountNumber", "accountNumber"],
  ["routingNumber", "bankRoutingNumber"],
  ["branchNumber", "branchNumber"],
  ["pin", "pin"],
  ["swiftCode", "swiftCode"],
  ["iban", "iban"],
  ["bankContactPhone", "bankContactPhone"],
];
const DRIVERS_LICENSE: Spec[] = [
  ["firstName", "firstName"],
  ["middleName", "middleName"],
  ["lastName", "lastName"],
  ["dateOfBirth", "dateOfBirth"],
  ["licenseNumber", "licenseNumber"],
  ["issuingCountry", "issuingCountry"],
  ["issuingState", "issuingState"],
  ["issueDate", "issueDate"],
  ["expirationDate", "expirationDate"],
  ["issuingAuthority", "issuingAuthority"],
  ["licenseClass", "licenseClass"],
];
const PASSPORT: Spec[] = [
  ["givenName", "firstName"],
  ["surname", "lastName"],
  ["dateOfBirth", "dateOfBirth"],
  ["sex", "sex"],
  ["birthPlace", "birthPlace"],
  ["nationality", "nationality"],
  ["issuingCountry", "issuingCountry"],
  ["passportNumber", "passportNumber"],
  ["passportType", "passportType"],
  ["nationalIdentificationNumber", "nationalIdentificationNumber"],
  ["issuingAuthority", "issuingAuthority"],
  ["issueDate", "issueDate"],
  ["expirationDate", "expirationDate"],
];

function plain(prefix: string, part: unknown, specs: Spec[], t: Translate): Entry[] {
  const values = (part ?? {}) as Record<string, unknown>;
  return specs.map(([property, label]) => ({
    key: `${prefix}.${property}`,
    label: t(label),
    value: text(values[property]),
    secret: isSecretValue(`${prefix}.${property}`),
  }));
}

/** Everything someone sees of an item, in the order the item view shows it. */
export function itemEntries(item: CipherView, t: Translate): Entry[] {
  const entries: Entry[] = [
    { key: "type", label: t("type"), value: typeLabel(item.type, t) },
    { key: "name", label: t("itemName"), value: text(item.name) },
  ];

  switch (item.type) {
    case CipherType.Login: {
      const login = item.login;
      entries.push(
        {
          key: "login.username",
          label: t("username"),
          value: text(login?.username),
          secret: isSecretValue("login.username"),
        },
        {
          key: "login.password",
          label: t("password"),
          value: text(login?.password),
          secret: isSecretValue("login.password"),
        },
        {
          key: "login.totp",
          label: t("verificationCodeTotp"),
          value: text(login?.totp),
          secret: isSecretValue("login.totp"),
        },
      );
      (login?.uris ?? []).forEach((uri, i) =>
        entries.push({ key: `login.uri.${i}`, label: t("website"), value: text(uri?.uri) }),
      );
      (login?.fido2Credentials ?? []).forEach((passkey, i) =>
        entries.push({
          key: `login.passkey.${i}`,
          label: t("typePasskey"),
          value: [passkey.rpName || passkey.rpId, passkey.userName].filter(Boolean).join(", "),
          compare: text(passkey.credentialId),
        }),
      );
      break;
    }
    case CipherType.Card: {
      const card = item.card;
      const expiration = [card?.expMonth, card?.expYear].filter((v) => !!v).join(" / ");
      entries.push(
        {
          key: "card.cardholderName",
          label: t("cardholderName"),
          value: text(card?.cardholderName),
          secret: isSecretValue("card.cardholderName"),
        },
        {
          key: "card.brand",
          label: t("brand"),
          value: text(card?.brand),
          secret: isSecretValue("card.brand"),
        },
        {
          key: "card.number",
          label: t("number"),
          value: text(card?.number),
          secret: isSecretValue("card.number"),
        },
        {
          key: "card.expiration",
          label: t("expiration"),
          value: expiration,
          secret: isSecretValue("card.expiration"),
        },
        {
          key: "card.code",
          label: t("securityCode"),
          value: text(card?.code),
          secret: isSecretValue("card.code"),
        },
      );
      break;
    }
    case CipherType.Identity:
      entries.push(...plain("identity", item.identity, IDENTITY, t));
      break;
    case CipherType.SshKey:
      entries.push(...plain("sshKey", item.sshKey, SSH_KEY, t));
      break;
    case CipherType.BankAccount:
      entries.push(...plain("bankAccount", item.bankAccount, BANK_ACCOUNT, t));
      break;
    case CipherType.DriversLicense:
      entries.push(...plain("driversLicense", item.driversLicense, DRIVERS_LICENSE, t));
      break;
    case CipherType.Passport:
      entries.push(...plain("passport", item.passport, PASSPORT, t));
      break;
  }

  const expires = (item.fields ?? []).find((f) => f.name === EXPIRES_FIELD_NAME)?.value;
  entries.push({ key: "expires", label: t("keykeeperExpires"), value: text(expires) });
  entries.push({ key: "notes", label: t("notes"), value: text(item.notes) });

  // Custom fields by name; a name used twice is told apart by its place.
  const seen = new Map<string, number>();
  for (const field of visibleCustomFields(item.fields)) {
    const name = text(field.name);
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    let value = text(field.value);
    if (field.type === FieldType.Boolean) {
      value = value === "true" ? t("yes") : t("no");
    } else if (field.type === FieldType.Linked) {
      value = t("cfTypeLinked");
    }
    entries.push({
      key: `field.${name}.${n}`,
      label: name,
      value,
      secret: isSecretField(field.type),
    });
  }

  // Whether it changed comes from the setting itself, not its words.
  const asks = item.reprompt === CipherRepromptType.Password;
  entries.push({
    key: "reprompt",
    label: t("passwordPrompt"),
    value: asks ? t("keykeeperOn") : t("keykeeperOff"),
    compare: asks ? "on" : "off",
  });
  return entries;
}

/**
 * A version next to the item as it is now, field by field: every field either
 * has, with the ones that differ marked. Fields neither has are left out, and
 * the item's type only shows when it differs.
 */
export function versionRows(version: CipherView, current: CipherView, t: Translate): VersionRow[] {
  const before = new Map(itemEntries(version, t).map((e) => [e.key, e]));
  const after = new Map(itemEntries(current, t).map((e) => [e.key, e]));
  // The current item's order, with fields only the version has after theirs.
  const keys = [...after.keys(), ...[...before.keys()].filter((k) => !after.has(k))];
  const rows: VersionRow[] = [];
  for (const key of keys) {
    const was = before.get(key);
    const now = after.get(key);
    const changed = (was?.compare ?? was?.value ?? "") !== (now?.compare ?? now?.value ?? "");
    if (!was?.value && !now?.value && !changed) {
      continue;
    }
    if (key === "type" && !changed) {
      continue;
    }
    // "Off" is how an item without re-prompt reads; it's only news when it changed.
    if (key === "reprompt" && !changed) {
      continue;
    }
    rows.push({
      key,
      label: (now ?? was)!.label,
      version: was?.value ?? "",
      current: now?.value ?? "",
      secret: !!(was?.secret || now?.secret),
      changed,
    });
  }
  return rows;
}

/** Whether two versions look the same to someone reading them. */
export function sameFields(a: CipherView, b: CipherView): boolean {
  return versionRows(a, b, (key) => key).every((row) => !row.changed);
}

/**
 * The versions worth listing, newest first. Apps encrypt the whole item on
 * every save, so the server keeps a version for a save that changed nothing
 * anyone sees (a favorite toggled by an app that saves the whole item, say).
 * Of each run of versions that look the same, the oldest stays: it's the one
 * whose "saved by" names who wrote those contents. Versions that look like
 * the item now, newer than any change, are the item itself and don't show.
 */
export function distinctVersions<T extends { view: CipherView }>(
  newestFirst: T[],
  current: CipherView,
): T[] {
  let newest = 0;
  while (newest < newestFirst.length && sameFields(newestFirst[newest].view, current)) {
    newest++;
  }
  return newestFirst.filter((version, i) => {
    const older = newestFirst[i + 1];
    return i >= newest && (older == null || !sameFields(version.view, older.view));
  });
}

/** Who a passkey is for, as the apps say it: "shop.example.test, ana". */
function passkeyLabel(passkey: Fido2CredentialView): string {
  return [passkey.rpName || passkey.rpId, passkey.userName].filter(Boolean).join(", ");
}

/**
 * The passkeys restoring a version would take from the item: ones it has now
 * that the version doesn't, by credential id, as the apps decide
 * (passbundle-apps, vault.rs, `restore_drops`). Who each is for, to warn
 * before restoring.
 */
export function droppedPasskeys(version: CipherView, current: CipherView): string[] {
  const then = new Set(
    (version.login?.fido2Credentials ?? []).map((p) => p.credentialId).filter(Boolean),
  );
  return (current.login?.fido2Credentials ?? [])
    .filter((p) => !then.has(p.credentialId))
    .map(passkeyLabel);
}

/**
 * The version's passkeys as restoring saves them: each one the item still has
 * stays as it is now, so a raised sign-in counter never goes back (a site
 * refuses a passkey whose counter does), unless the version's counter is
 * somehow higher. One the item no longer has comes back from the version.
 */
function restoredPasskeys(
  version: Fido2CredentialView[],
  current: Fido2CredentialView[] | null | undefined,
): Fido2CredentialView[] {
  return version.map((then) => {
    const now = (current ?? []).find(
      (p) => p.credentialId === then.credentialId && (p.counter ?? 0) >= (then.counter ?? 0),
    );
    return now ?? then;
  });
}

/**
 * The item as this version had it, to save as a normal edit: the version's
 * contents, with what isn't part of versions kept as it is now (its id,
 * organization, folder, favorite, collections, attachments, item key, and
 * revision date, which the save sends as the last one it knows of, so it
 * can't overwrite a newer edit). A passkey the item still has stays as it is
 * now (`restoredPasskeys`). Saving it puts the replaced password in password
 * history, as any edit does.
 */
export function restoredView(version: CipherView, current: CipherView): CipherView {
  const restored = Object.assign(new CipherView(), current);
  restored.type = version.type;
  restored.name = version.name;
  restored.notes = version.notes;
  restored.fields = version.fields;
  restored.reprompt = version.reprompt;
  if (version.login != null) {
    const login = Object.assign(new LoginView(), version.login);
    if (version.login.fido2Credentials != null) {
      login.fido2Credentials = restoredPasskeys(
        version.login.fido2Credentials,
        current.login?.fido2Credentials,
      );
    }
    restored.login = login;
  } else {
    restored.login = version.login;
  }
  restored.card = version.card;
  restored.identity = version.identity;
  restored.secureNote = version.secureNote;
  restored.sshKey = version.sshKey;
  restored.bankAccount = version.bankAccount;
  restored.driversLicense = version.driversLicense;
  restored.passport = version.passport;
  return restored;
}

/**
 * The question before restoring a version, for the simple dialog: what goes
 * back and what stays, and, when the version lacks passkeys the item has now,
 * that restoring removes them (as the apps say it), with "Restore anyway".
 */
export function restoreConfirmation(version: CipherView, current: CipherView, when: string) {
  const drops = droppedPasskeys(version, current);
  const content =
    drops.length === 0
      ? { key: "keykeeperRestoreVersionDesc", placeholders: [when] }
      : drops.length === 1
        ? { key: "keykeeperRestoreVersionDropsPasskey", placeholders: [when, drops[0]] }
        : {
            key: "keykeeperRestoreVersionDropsPasskeys",
            placeholders: [when, String(drops.length), drops.join("; ")],
          };
  return {
    title: { key: "keykeeperRestoreVersionTitle" },
    content,
    acceptButtonText: {
      key: drops.length === 0 ? "keykeeperRestoreVersion" : "keykeeperRestoreAnyway",
    },
    type: "warning" as const,
  };
}
