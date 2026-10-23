// Keykeeper: an item's past versions (DESIGN.md, "Item history"). The server
// keeps each version encrypted as it was stored and returns them for anyone
// who can open the item; apps decrypt them like the item, compare them field
// by field, and restore one by saving it as a normal edit.

import { CipherRepromptType, CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { EXPIRES_FIELD_NAME } from "@bitwarden/common/vault/keykeeper/expiration";
import { visibleCustomFields } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

/** Who saved a version, as the server lets the caller see them. */
export type VersionEditor = { id: string | null; name: string | null; email: string | null };

/** GET /api/keykeeper/ciphers/<id>/history. */
export type ItemHistoryResponse = {
  object: "keykeeperCipherHistory";
  cipherId: string;
  revisionDate: string;
  /** Who saved the item as it is now. */
  savedBy: VersionEditor | null;
  /** Newest first. */
  data: {
    object: "keykeeperCipherVersion";
    id: string;
    revisionDate: string;
    replacedDate: string;
    savedBy: VersionEditor | null;
    /** The version as an item response, to decrypt like any item. */
    cipher: unknown;
  }[];
};

export const historyPath = (cipherId: string) => `/keykeeper/ciphers/${cipherId}/history`;

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

/** Plain fields of a type's part of an item: [property, label key, secret]. */
type Spec = [string, string, boolean?];

const IDENTITY: Spec[] = [
  ["title", "title"],
  ["firstName", "firstName"],
  ["middleName", "middleName"],
  ["lastName", "lastName"],
  ["username", "username"],
  ["company", "company"],
  ["ssn", "ssn", true],
  ["passportNumber", "passportNumber", true],
  ["licenseNumber", "licenseNumber", true],
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
  ["privateKey", "sshPrivateKey", true],
  ["publicKey", "sshPublicKey"],
  ["keyFingerprint", "sshFingerprint"],
];
const BANK_ACCOUNT: Spec[] = [
  ["bankName", "bankName"],
  ["nameOnAccount", "nameOnAccount"],
  ["accountType", "bankAccountType"],
  ["accountNumber", "accountNumber", true],
  ["routingNumber", "bankRoutingNumber"],
  ["branchNumber", "branchNumber"],
  ["pin", "pin", true],
  ["swiftCode", "swiftCode", true],
  ["iban", "iban", true],
  ["bankContactPhone", "bankContactPhone"],
];
const DRIVERS_LICENSE: Spec[] = [
  ["firstName", "firstName"],
  ["middleName", "middleName"],
  ["lastName", "lastName"],
  ["dateOfBirth", "dateOfBirth"],
  ["licenseNumber", "licenseNumber", true],
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
  ["passportNumber", "passportNumber", true],
  ["passportType", "passportType"],
  ["nationalIdentificationNumber", "nationalIdentificationNumber", true],
  ["issuingAuthority", "issuingAuthority"],
  ["issueDate", "issueDate"],
  ["expirationDate", "expirationDate"],
];

function plain(prefix: string, part: unknown, specs: Spec[], t: Translate): Entry[] {
  const values = (part ?? {}) as Record<string, unknown>;
  return specs.map(([property, label, secret]) => ({
    key: `${prefix}.${property}`,
    label: t(label),
    value: text(values[property]),
    secret: !!secret,
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
        { key: "login.username", label: t("username"), value: text(login?.username) },
        { key: "login.password", label: t("password"), value: text(login?.password), secret: true },
        {
          key: "login.totp",
          label: t("verificationCodeTotp"),
          value: text(login?.totp),
          secret: true,
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
        },
        { key: "card.brand", label: t("brand"), value: text(card?.brand) },
        { key: "card.number", label: t("number"), value: text(card?.number), secret: true },
        { key: "card.expiration", label: t("expiration"), value: expiration },
        { key: "card.code", label: t("securityCode"), value: text(card?.code), secret: true },
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
      secret: field.type === FieldType.Hidden,
    });
  }

  entries.push({
    key: "reprompt",
    label: t("passwordPrompt"),
    value: item.reprompt === CipherRepromptType.Password ? t("on") : t("off"),
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
 * The versions worth listing, newest first: those that differ from the one
 * after them (the newest from the item now). Apps encrypt the whole item on
 * every save, so the server keeps a version for a favorite toggled in the web
 * vault too, and those look like the version after them.
 */
export function distinctVersions<T extends { view: CipherView }>(
  newestFirst: T[],
  current: CipherView,
): T[] {
  return newestFirst.filter((version, i) => {
    const newer = i === 0 ? current : newestFirst[i - 1].view;
    return !sameFields(version.view, newer);
  });
}

/**
 * The item as this version had it, to save as a normal edit: the version's
 * contents, with what isn't part of versions kept as it is now (its id,
 * organization, folder, favorite, collections, attachments, and item key).
 * Saving it puts the replaced password in password history, as any edit does.
 */
export function restoredView(version: CipherView, current: CipherView): CipherView {
  const restored = Object.assign(new CipherView(), current);
  restored.type = version.type;
  restored.name = version.name;
  restored.notes = version.notes;
  restored.fields = version.fields;
  restored.reprompt = version.reprompt;
  restored.login = version.login;
  restored.card = version.card;
  restored.identity = version.identity;
  restored.secureNote = version.secureNote;
  restored.sshKey = version.sshKey;
  restored.bankAccount = version.bankAccount;
  restored.driversLicense = version.driversLicense;
  restored.passport = version.passport;
  return restored;
}
