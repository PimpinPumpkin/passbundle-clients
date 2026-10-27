// Keykeeper: what someone without "see passwords" in an item's shared
// folders may never reveal or copy (DESIGN.md, "Folders and permissions").
// The server sends the whole item, since autofill needs it, so the apps keep
// these hidden on every path: the item's page, copy buttons, menus, keyboard
// shortcuts, the fill menu inside websites, password history, version
// history, and the editor. Filling them into a website still works.
//
// One rule for the web vault, the extension, and the apps (passbundle-apps,
// core/src/vault.rs, `Item::is_secret`): every value is a secret except an
// allowlist of plain ones, so a value of a new kind, or one added later, is
// hidden until someone says it's plain.

import { FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";

/** The mask shown in place of a hidden value, so the value isn't in the page at all. */
export const HIDDEN_VALUE_MASK = "••••••••";

/**
 * Every value of each kind of item, by property, in the order the item view
 * shows them. With `PLAIN_VALUES`, what a copy must leave out
 * (`clearHiddenSecrets`) and what version history masks.
 */
export const ITEM_VALUES = {
  login: ["username", "password", "totp"],
  card: ["cardholderName", "brand", "number", "expMonth", "expYear", "code"],
  identity: [
    "title",
    "firstName",
    "middleName",
    "lastName",
    "username",
    "company",
    "ssn",
    "passportNumber",
    "licenseNumber",
    "email",
    "phone",
    "address1",
    "address2",
    "address3",
    "city",
    "state",
    "postalCode",
    "country",
  ],
  sshKey: ["privateKey", "publicKey", "keyFingerprint"],
  bankAccount: [
    "bankName",
    "nameOnAccount",
    "accountType",
    "accountNumber",
    "routingNumber",
    "branchNumber",
    "pin",
    "swiftCode",
    "iban",
    "bankContactPhone",
  ],
  driversLicense: [
    "firstName",
    "middleName",
    "lastName",
    "dateOfBirth",
    "licenseNumber",
    "issuingCountry",
    "issuingState",
    "issueDate",
    "expirationDate",
    "issuingAuthority",
    "licenseClass",
  ],
  passport: [
    "givenName",
    "surname",
    "dateOfBirth",
    "sex",
    "birthPlace",
    "nationality",
    "issuingCountry",
    "passportNumber",
    "passportType",
    "nationalIdentificationNumber",
    "issuingAuthority",
    "issueDate",
    "expirationDate",
  ],
} as const;

export type ItemValuePart = keyof typeof ITEM_VALUES;

/**
 * The plain values, as `part.property`: the only ones someone who can open an
 * item but not see its passwords gets. The same list as the apps'
 * (`PLAIN_DETAILS` and the newer kinds' plain details): the item's name,
 * notes, and websites; the username; a card's holder, brand, and expiry; an
 * identity's name, company, username, email, phone, and address; an SSH
 * key's public key and fingerprint; and the newer kinds' names, dates,
 * places, and the bank's routing and branch numbers. Everything else (the
 * password, one-time code, card number and code, SSN, passport and license
 * numbers, private key, account number, PIN, SWIFT, IBAN, national ID) is a
 * secret, as is anything not listed here.
 */
export const PLAIN_VALUES: ReadonlySet<string> = new Set([
  "name",
  "notes",
  "login.username",
  "login.uri",
  // A passkey's site and user name; its key is never shown.
  "login.passkey",
  "card.cardholderName",
  "card.brand",
  "card.expMonth",
  "card.expYear",
  "card.expiration",
  "identity.title",
  "identity.firstName",
  "identity.middleName",
  "identity.lastName",
  "identity.username",
  "identity.company",
  "identity.email",
  "identity.phone",
  "identity.address1",
  "identity.address2",
  "identity.address3",
  "identity.city",
  "identity.state",
  "identity.postalCode",
  "identity.country",
  "sshKey.publicKey",
  "sshKey.keyFingerprint",
  "bankAccount.bankName",
  "bankAccount.nameOnAccount",
  "bankAccount.accountType",
  "bankAccount.routingNumber",
  "bankAccount.branchNumber",
  "bankAccount.bankContactPhone",
  "driversLicense.firstName",
  "driversLicense.middleName",
  "driversLicense.lastName",
  "driversLicense.dateOfBirth",
  "driversLicense.issuingCountry",
  "driversLicense.issuingState",
  "driversLicense.issueDate",
  "driversLicense.expirationDate",
  "driversLicense.issuingAuthority",
  "driversLicense.licenseClass",
  "passport.givenName",
  "passport.surname",
  "passport.dateOfBirth",
  "passport.sex",
  "passport.birthPlace",
  "passport.nationality",
  "passport.issuingCountry",
  "passport.passportType",
  "passport.issuingAuthority",
  "passport.issueDate",
  "passport.expirationDate",
]);

/** Whether a value, as `part.property`, is a secret: anything not known to be plain. */
export function isSecretValue(key: string): boolean {
  return !PLAIN_VALUES.has(key);
}

/** Custom fields that are plain: text, yes or no, and links to another field. */
const PLAIN_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.Text,
  FieldType.Boolean,
  FieldType.Linked,
]);

/** Whether a custom field's value is a secret: a hidden field, or a kind not known to be plain. */
export function isSecretField(type: FieldType | null | undefined): boolean {
  return type == null || !PLAIN_FIELD_TYPES.has(type);
}

/** The value each copy action copies, as `part.property`. */
const COPY_ACTION_VALUES: Readonly<Record<string, string>> = {
  username: "login.username",
  password: "login.password",
  totp: "login.totp",
  cardNumber: "card.number",
  securityCode: "card.code",
  email: "identity.email",
  phone: "identity.phone",
  address: "identity.address1",
  secureNote: "notes",
  privateKey: "sshKey.privateKey",
  publicKey: "sshKey.publicKey",
  keyFingerprint: "sshKey.keyFingerprint",
  nameOnAccount: "bankAccount.nameOnAccount",
  accountNumber: "bankAccount.accountNumber",
  routingNumber: "bankAccount.routingNumber",
  branchNumber: "bankAccount.branchNumber",
  pin: "bankAccount.pin",
  iban: "bankAccount.iban",
  swiftCode: "bankAccount.swiftCode",
  firstNameLicense: "driversLicense.firstName",
  middleNameLicense: "driversLicense.middleName",
  lastNameLicense: "driversLicense.lastName",
  licenseNumber: "driversLicense.licenseNumber",
  passportNumber: "passport.passportNumber",
  nationalIdentificationNumber: "passport.nationalIdentificationNumber",
  givenName: "passport.givenName",
  surname: "passport.surname",
};

/** Whether a copy action copies a secret: hidden fields, and any action not known to be plain. */
export function isSecretCopyAction(action: string): boolean {
  const key = COPY_ACTION_VALUES[action];
  return key == null || isSecretValue(key);
}

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

/** Whether the person may see one of the item's values, as `part.property`. */
export function mayShow(item: SecretsLike | null | undefined, key: string): boolean {
  return maySeeSecrets(item) || !isSecretValue(key);
}

/** Whether copying this kind of value from the item is allowed. */
export function mayCopy(item: SecretsLike | null | undefined, action: string): boolean {
  return maySeeSecrets(item) || !isSecretCopyAction(action);
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
 * Takes every secret out of an item: for a copy made from an item whose
 * secrets the person can't see (a clone, from any page that offers one), so
 * the copy, which would be theirs, can't carry them. Every value the
 * allowlist doesn't call plain goes, with hidden fields' values, passkeys,
 * and password history.
 */
export function clearHiddenSecrets(cipher: CipherView): void {
  for (const [part, properties] of Object.entries(ITEM_VALUES)) {
    const values = (cipher as unknown as Record<string, Record<string, unknown> | null>)[part];
    if (values == null) {
      continue;
    }
    for (const property of properties) {
      if (isSecretValue(`${part}.${property}`)) {
        // An SSH key's private key is a string, never undefined.
        values[property] = part === "sshKey" ? "" : undefined;
      }
    }
  }
  if (cipher.login != null) {
    cipher.login.fido2Credentials = [];
  }
  for (const field of cipher.fields ?? []) {
    if (isSecretField(field.type)) {
      field.value = undefined;
    }
  }
  cipher.passwordHistory = [];
}
