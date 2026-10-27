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

import { CipherType, FieldType, LinkedIdType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { LoginUriView } from "../models/view/login-uri.view";

/** The mask shown in place of a hidden value, so the value isn't in the page at all. */
export const HIDDEN_VALUE_MASK = "••••••••";

/**
 * Every value of each kind of item, by property, in the order the item view
 * shows them. With `PLAIN_VALUES`, what a copy may carry (`plainItem`) and
 * what version history masks.
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
  // The name, as the item shows it: made of the three above.
  "identity.fullName",
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
 * yes shows them: an item that doesn't say (`viewPassword` missing), or no
 * item at all, keeps them hidden. The server says on every item it sends (the
 * person's own items with yes), so failing closed costs nothing.
 */
export function maySeeSecrets(item: SecretsLike | null | undefined): boolean {
  return item?.viewPassword === true;
}

/** Whether the person may see one of the item's values, as `part.property`. */
export function mayShow(item: SecretsLike | null | undefined, key: string): boolean {
  return maySeeSecrets(item) || !isSecretValue(key);
}

/**
 * For the editor, which has no original item when the person is making a new
 * one: a new item is theirs, so its secrets are too. An existing item follows
 * `maySeeSecrets`.
 */
export function maySeeSecretsOrNew(original: SecretsLike | null | undefined): boolean {
  return original == null || maySeeSecrets(original);
}

/** `mayShow`, for the editor: a new item (no original) is the person's own. */
export function mayShowOrNew(original: SecretsLike | null | undefined, key: string): boolean {
  return original == null || mayShow(original, key);
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

/** Which part of an item holds its values, by kind of item. */
const PART_OF_KIND: Readonly<Partial<Record<CipherType, ItemValuePart>>> = {
  [CipherType.Login]: "login",
  [CipherType.Card]: "card",
  [CipherType.Identity]: "identity",
  [CipherType.SshKey]: "sshKey",
  [CipherType.BankAccount]: "bankAccount",
  [CipherType.DriversLicense]: "driversLicense",
  [CipherType.Passport]: "passport",
};

/** An item, as far as linked custom fields go: its kind, and what each link fills. */
export type LinkedFieldsLike = {
  type?: CipherType | null;
  linkedFieldOptions?: { get(id: number): { propertyKey: string } | undefined } | null;
};

/**
 * Whether a linked custom field fills a secret: one that fills the password,
 * a card's number or code, an SSN, or a passport or license number, say, or a
 * link the item doesn't know.
 */
export function isSecretLinkedField(
  item: LinkedFieldsLike | null | undefined,
  linkedId: LinkedIdType | null | undefined,
): boolean {
  const part = item?.type == null ? undefined : PART_OF_KIND[item.type];
  if (part == null || linkedId == null) {
    return true;
  }
  const option = item?.linkedFieldOptions?.get(linkedId);
  return option == null || isSecretValue(`${part}.${option.propertyKey}`);
}

/** Whether a custom field's value is a secret: a hidden field, a link to a secret, or a kind not known to be plain. */
export function isSecretCustomField(
  item: LinkedFieldsLike | null | undefined,
  field: { type?: FieldType | null; linkedId?: LinkedIdType | null },
): boolean {
  return field.type === FieldType.Linked
    ? isSecretLinkedField(item, field.linkedId)
    : isSecretField(field.type);
}

/**
 * A copy of an item with only its plain values: what a copy made from an item
 * whose secrets the person can't see may carry (a clone, however it was
 * started), so the copy, which would be theirs, can't take them. It's built
 * up from the allowlist rather than by taking secrets out, so a value added to
 * items later is left out until someone decides it's plain. Besides the plain
 * values it keeps only what the item is and where it lives: its kind, owner,
 * folder and shared folders, favorite, master password re-prompt, and what the
 * person may do with it. Never its id or key, attachments, passkeys, password
 * history, hidden fields, or links to secrets.
 */
export function plainItem(source: CipherView): CipherView {
  const copy = new CipherView();
  copy.type = source.type;
  copy.organizationId = source.organizationId;
  copy.folderId = source.folderId;
  copy.collectionIds = [...(source.collectionIds ?? [])];
  copy.favorite = source.favorite;
  copy.reprompt = source.reprompt;
  copy.edit = source.edit;
  copy.viewPassword = source.viewPassword;
  copy.permissions = source.permissions;
  copy.organizationUseTotp = source.organizationUseTotp;
  copy.name = source.name;
  if (!isSecretValue("notes")) {
    copy.notes = source.notes;
  }

  for (const [part, properties] of Object.entries(ITEM_VALUES)) {
    const from = (source as unknown as Record<string, Record<string, unknown> | null>)[part];
    const to = (copy as unknown as Record<string, Record<string, unknown> | null>)[part];
    if (from == null || to == null) {
      continue;
    }
    for (const property of properties) {
      if (!isSecretValue(`${part}.${property}`)) {
        to[property] = from[property];
      } else if (part === "sshKey") {
        // An SSH key's values are strings, never undefined; the editor needs one.
        to[property] = "";
      }
    }
  }
  if (!isSecretValue("login.uri")) {
    copy.login.uris = (source.login?.uris ?? []).map((uri) => {
      const plain = new LoginUriView();
      plain.uri = uri.uri;
      plain.match = uri.match;
      return plain;
    });
  }
  copy.secureNote.type = source.secureNote?.type ?? copy.secureNote.type;

  copy.fields = (source.fields ?? [])
    .filter((field) => !isSecretCustomField(source, field))
    .map((field) => {
      const plain = new FieldView();
      plain.name = field.name;
      plain.type = field.type;
      plain.value = field.value;
      plain.linkedId = field.linkedId;
      return plain;
    });
  return copy;
}
