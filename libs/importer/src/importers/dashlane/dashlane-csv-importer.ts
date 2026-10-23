// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { SecureNoteType, CipherType } from "@bitwarden/common/vault/enums";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { ImportResult } from "../../models/import-result";
import { BaseImporter } from "../base-importer";
import { Importer } from "../importer";

import {
  CredentialsRecord,
  IdRecord,
  PaymentsRecord,
  PersonalInformationRecord,
  SecureNoteRecord,
} from "./types/dashlane-csv-types";

const _mappedCredentialsColumns = new Set([
  "title",
  "note",
  "username",
  "password",
  "url",
  "otpSecret",
  // Keykeeper: the TOTP secret in newer exports, already the item's TOTP; not a text field too.
  "otpUrl",
  "category",
]);

const _mappedPersonalInfoAsIdentityColumns = new Set([
  "type",
  "title",
  "first_name",
  "middle_name",
  "last_name",
  "login",
  "email",
  "phone_number",
  "address",
  "country",
  "state",
  "city",
  "zip",
  // Skip item_name as we already have set a combined name
  "item_name",
]);

const _mappedSecureNoteColumns = new Set(["title", "note"]);

export class DashlaneCsvImporter extends BaseImporter implements Importer {
  parse(data: string): Promise<ImportResult> {
    const result = new ImportResult();
    const results = this.parseCsv(data, true);
    if (results == null) {
      result.success = false;
      return Promise.resolve(result);
    }

    if (results[0].type != null && results[0].title != null) {
      // Keykeeper: an identity for each person, however many there are.
      this.peopleOf(results as PersonalInformationRecord[]).forEach((rows) => {
        const cipher = this.initLoginCipher();
        cipher.type = CipherType.Identity;
        cipher.identity = new IdentityView();
        rows.forEach((row) => {
          this.parsePersonalInformationRecordAsIdentity(cipher, row);
        });
        if (this.isNullOrWhitespace(cipher.name)) {
          cipher.name = rows.find((r) => !this.isNullOrWhitespace(r.item_name))?.item_name;
        }
        this.cleanupCipher(cipher);
        result.ciphers.push(cipher);
      });
      result.success = true;
      return Promise.resolve(result);
    }

    results.forEach((row) => {
      const cipher = this.initLoginCipher();

      const rowKeys = Object.keys(row);
      if (rowKeys[0] === "username") {
        this.processFolder(result, row.category);
        this.parseCredentialsRecord(cipher, row);
      }

      if (rowKeys[0] === "type" && rowKeys[1] === "account_name") {
        this.parsePaymentRecord(cipher, row);
      }

      if (rowKeys[0] === "type" && rowKeys[1] === "number") {
        this.parseIdRecord(cipher, row);
      }

      if (rowKeys[0] === "type" && rowKeys[1] === "title") {
        this.parsePersonalInformationRecord(cipher, row);
      }

      if (rowKeys[0] === "title" && rowKeys[1] === "note") {
        this.parseSecureNoteRecords(cipher, row);
      }

      this.convertToNoteIfNeeded(cipher);
      this.cleanupCipher(cipher);
      result.ciphers.push(cipher);
    });

    if (this.organization) {
      this.moveFoldersToCollections(result);
    }

    result.success = true;
    return Promise.resolve(result);
  }

  parseCredentialsRecord(cipher: CipherView, row: CredentialsRecord) {
    cipher.type = CipherType.Login;
    cipher.login = new LoginView();

    cipher.name = row.title;
    cipher.notes = row.note;
    cipher.login.username = row.username;
    cipher.login.password = row.password;
    cipher.login.totp = Object.keys(row).includes("otpUrl") ? row.otpUrl : row.otpSecret;
    cipher.login.uris = this.makeUriArray(row.url);

    this.importUnmappedFields(cipher, row, _mappedCredentialsColumns);
  }

  parsePaymentRecord(cipher: CipherView, row: PaymentsRecord) {
    cipher.type = CipherType.Card;
    cipher.card = new CardView();

    cipher.name = row.account_name;
    let mappedValues: string[] = [];
    switch (row.type) {
      case "credit_card": {
        // Keykeeper: a card is named by its brand and last four digits ("Visa ending
        // 1111"), not its holder, unless the export has a name for it: a title column, or
        // an account name that isn't the holder's.
        const row_ = row as PaymentsRecord & Record<string, string>;
        const titleColumn = ["title", "name", "item_name", "card_name", "nickname"].find(
          (column) => !this.isNullOrWhitespace(row_[column]),
        );
        const accountNameIsTitle =
          !this.isNullOrWhitespace(row.account_holder) &&
          !this.isNullOrWhitespace(row.account_name) &&
          row.account_name.trim() !== row.account_holder.trim();
        cipher.card.cardholderName = this.getValueOrDefault(
          accountNameIsTitle ? row.account_holder : row.account_name,
        );
        cipher.card.number = row.cc_number;
        cipher.card.brand = CardView.getCardBrandByPatterns(cipher.card.number);
        cipher.card.code = row.code;
        this.setCardExpiration(cipher, `${row.expiration_month}/${row.expiration_year}`);
        cipher.name =
          titleColumn != null
            ? row_[titleColumn]
            : accountNameIsTitle
              ? row.account_name
              : (this.cardName(cipher.card) ?? row.account_name);

        // If you add more mapped fields please extend this
        mappedValues = [
          "type",
          "account_name",
          "account_holder",
          "cc_number",
          "code",
          "expiration_month",
          "expiration_year",
          ...(titleColumn != null ? [titleColumn] : []),
        ];
        break;
      }
      case "bank":
        cipher.card.cardholderName = row.account_holder;
        cipher.card.number = row.account_number;

        // If you add more mapped fields please extend this
        mappedValues = ["account_name", "account_holder", "account_number"];
        break;
      default:
        break;
    }

    this.importUnmappedFields(cipher, row, new Set(mappedValues));
  }

  parseIdRecord(cipher: CipherView, row: IdRecord) {
    cipher.type = CipherType.Identity;
    cipher.identity = new IdentityView();

    const mappedValues: string[] = ["name", "number"];
    switch (row.type) {
      case "card":
        cipher.name = `${row.name} ${row.type}`;
        this.processFullName(cipher, row.name);
        cipher.identity.licenseNumber = row.number;
        break;
      case "passport":
        cipher.name = `${row.name} ${row.type}`;
        this.processFullName(cipher, row.name);
        cipher.identity.passportNumber = row.number;
        break;
      case "license":
        cipher.name = `${row.name} ${row.type}`;
        this.processFullName(cipher, row.name);
        cipher.identity.licenseNumber = row.number;
        cipher.identity.state = row.state;

        mappedValues.push("state");
        break;
      case "social_security":
        cipher.name = `${row.name} ${row.type}`;
        this.processFullName(cipher, row.name);
        cipher.identity.ssn = row.number;
        break;
      case "tax_number":
        cipher.name = row.type;
        cipher.identity.licenseNumber = row.number;
        break;

      default:
        break;
    }

    // If you add more mapped fields please extend this
    this.importUnmappedFields(cipher, row, new Set(mappedValues));
  }

  parsePersonalInformationRecord(cipher: CipherView, row: PersonalInformationRecord) {
    cipher.type = CipherType.SecureNote;
    cipher.secureNote.type = SecureNoteType.Generic;
    if (row.type === "name") {
      cipher.name = `${row.title} ${row.first_name} ${row.middle_name} ${row.last_name}`
        .replace("  ", " ")
        .trim();
    } else {
      cipher.name = row.item_name;
    }

    const dataRow = row as any;
    Object.keys(row).forEach((key) => {
      this.processKvp(cipher, key, dataRow[key]);
    });
  }

  parsePersonalInformationRecordAsIdentity(cipher: CipherView, row: PersonalInformationRecord) {
    // Keykeeper: a person's second email, number, or address is kept as a field, not
    // written over the first.
    const label = (fallback: string) => this.getValueOrDefault(row.item_name, fallback);
    switch (row.type) {
      case "name":
        // Keykeeper: Dashlane has a column for each part of the name.
        cipher.identity.title = this.getValueOrDefault(row.title);
        cipher.identity.firstName = this.getValueOrDefault(row.first_name);
        cipher.identity.middleName = this.getValueOrDefault(row.middle_name);
        cipher.identity.lastName = this.getValueOrDefault(row.last_name);
        cipher.name = cipher.identity.fullName;

        cipher.identity.username = this.getValueOrDefault(row.login);
        break;
      case "email":
        if (this.isNullOrWhitespace(cipher.identity.email)) {
          cipher.identity.email = row.email;
        } else {
          this.processKvp(cipher, label("email"), row.email);
        }
        break;
      case "number":
        if (this.isNullOrWhitespace(cipher.identity.phone)) {
          cipher.identity.phone = row.phone_number;
        } else {
          this.processKvp(cipher, label("phone_number"), row.phone_number);
        }
        break;
      case "address":
        if (
          this.isNullOrWhitespace(cipher.identity.address1) &&
          this.isNullOrWhitespace(cipher.identity.city)
        ) {
          cipher.identity.address1 = this.getValueOrDefault(row.address);
          cipher.identity.city = this.getValueOrDefault(row.city);
          cipher.identity.postalCode = this.getValueOrDefault(row.zip);
          cipher.identity.state = this.getValueOrDefault(row.state);
          cipher.identity.country = this.getValueOrDefault(row.country);
        } else {
          const address = [
            row.address,
            row.city,
            `${row.state ?? ""} ${row.zip ?? ""}`,
            row.country,
          ]
            .map((part) => (part ?? "").trim())
            .filter((part) => part !== "")
            .join(", ");
          this.processKvp(cipher, label("address"), address);
        }
        break;
      default:
        break;
    }

    this.importUnmappedFields(cipher, row, _mappedPersonalInfoAsIdentityColumns);
  }

  parseSecureNoteRecords(cipher: CipherView, row: SecureNoteRecord) {
    cipher.type = CipherType.SecureNote;
    cipher.secureNote.type = SecureNoteType.Generic;
    cipher.name = row.title;
    cipher.notes = row.note;

    this.importUnmappedFields(cipher, row, _mappedSecureNoteColumns);
  }

  /**
   * Keykeeper: personalInfo.csv's rows, person by person. A "name" row starts a person, and
   * the rows after it are theirs, unless a row's label or recipient names exactly one
   * other person ("Jane's email"). Rows before the first name are the first person's.
   */
  private peopleOf(rows: PersonalInformationRecord[]): PersonalInformationRecord[][] {
    const people: { names: string[]; rows: PersonalInformationRecord[] }[] = [];
    const before: PersonalInformationRecord[] = [];
    const letters = (s: string) => (s ?? "").trim().toLocaleLowerCase();
    // A letter or digit next to the name means it's part of another word, except the "s"
    // of "Johns email".
    const inWord = (c: string | undefined) =>
      c != null && (c.toLowerCase() !== c.toUpperCase() || /[0-9]/.test(c));
    const mentions = (text: string, name: string) => {
      for (let i = text.indexOf(name); name !== "" && i !== -1; i = text.indexOf(name, i + 1)) {
        const after = text.substring(i + name.length);
        if (
          !inWord(text[i - 1]) &&
          (!inWord(after[0]) || (after[0] === "s" && !inWord(after[1])))
        ) {
          return true;
        }
      }
      return false;
    };
    for (const row of rows) {
      if (row.type === "name") {
        const first = letters(row.first_name);
        const full = [first, letters(row.last_name)].filter((n) => n !== "").join(" ");
        people.push({ names: [full, first].filter((n) => n !== ""), rows: [] });
        continue;
      }
      if (people.length === 0) {
        before.push(row);
        continue;
      }
      const text = letters(`${row.item_name ?? ""} ${row.address_recipient ?? ""}`);
      const named = people.filter((p) => p.names.some((n) => mentions(text, n)));
      const current = people[people.length - 1];
      (named.length === 1 ? named[0] : current).rows.push(row);
    }
    if (people.length === 0) {
      return before.length > 0 ? [before] : [];
    }
    // Each person's name row first, then their other rows.
    const nameRows = rows.filter((r) => r.type === "name");
    return people.map((p, i) => [nameRows[i], ...(i === 0 ? before : []), ...p.rows]);
  }

  /** Keykeeper: "Visa ending 1111", or "Card ending 1111" with no brand. */
  private cardName(card: CardView): string | null {
    const digits = (card.number ?? "").replace(/\D/g, "");
    if (digits.length < 4) {
      return null;
    }
    return `${card.brand ?? "Card"} ending ${digits.slice(-4)}`;
  }

  importUnmappedFields(cipher: CipherView, row: any, mappedValues: Set<string>) {
    const unmappedFields = Object.keys(row).filter((x) => !mappedValues.has(x));
    unmappedFields.forEach((key) => {
      const item = row as any;
      this.processKvp(cipher, key, item[key]);
    });
  }
}
