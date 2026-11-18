// Keykeeper: what Passportal's and IT Glue's CSV exports become (the formats
// are in msp-formats.ts). A row is a login, or a secure note when it has
// nothing to sign in with: its name, username, password, website, notes, and
// one-time code secret, and every other column as a custom field, hidden
// unless the format knows the column is plain. The customer the row belongs
// to (Passportal's client, IT Glue's organization) is a folder, with the
// export's own folder under it ("Client/Folder"); into an organization those
// become shared folders, as for any import. An MSP's export holds every
// customer, and each is its own organization in PassBundle, so the import
// screen can ask for one customer's rows (`onlyCustomer`;
// components/keykeeper/msp-import.ts).

import { FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { ImportResult } from "../../models/import-result";
import { BaseImporter } from "../base-importer";
import { Importer } from "../importer";

import { columnKey, missingColumns, MspColumnRole, MspFormat, orList } from "./msp-formats";

/** A customer the file names and how many rows it has; "" for the rows that name none. */
export type MspCustomer = { name: string; rows: number };

/** A file's header and rows, or why it can't be imported. */
type Read = { header: string[]; rows: string[][]; roles: Map<MspColumnRole, number> };

const ROLES: readonly MspColumnRole[] = [
  "name",
  "username",
  "password",
  "url",
  "notes",
  "totp",
  "customer",
  "folder",
];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** "a Passportal export", "an IT Glue export". */
const anExport = (format: MspFormat) =>
  `${/^[AEIOU]/i.test(format.vendor) ? "an" : "a"} ${format.vendor} export`;

export abstract class MspCsvImporter extends BaseImporter implements Importer {
  /**
   * Only this customer's rows, by name as the file writes it ("" for the
   * rows that name none), or null for every row.
   */
  onlyCustomer: string | null = null;

  protected constructor(
    readonly format: MspFormat,
    private readonly otherFormat: MspFormat,
  ) {
    super();
  }

  /**
   * The customers this file names, with how many rows each has, by name (the
   * rows that name none last), or null when it isn't this format's file.
   */
  customers(data: string): MspCustomer[] | null {
    const read = this.read(data);
    if (typeof read === "string") {
      return null;
    }
    const counts = new Map<string, number>();
    for (const row of read.rows) {
      if (!this.isEmpty(row)) {
        const name = this.customerOf(read, row);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, rows]) => ({ name, rows }))
      .sort((a, b) =>
        a.name === ""
          ? 1
          : b.name === ""
            ? -1
            : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }

  parse(data: string): Promise<ImportResult> {
    const result = new ImportResult();
    const read = this.read(data);
    if (typeof read === "string") {
      result.success = false;
      result.errorMessage = read;
      return Promise.resolve(result);
    }

    let empty = 0;
    let others = 0;
    for (const row of read.rows) {
      if (this.isEmpty(row)) {
        empty++;
        continue;
      }
      const customer = this.customerOf(read, row);
      if (this.onlyCustomer != null && customer !== this.onlyCustomer) {
        others++;
        continue;
      }
      const cipher = this.cipherOf(read, row);
      const folder = this.folderPath(customer, this.cell(read, row, "folder"));
      if (folder !== "") {
        this.processFolder(result, folder);
      }
      result.ciphers.push(cipher);
    }

    if (result.ciphers.length === 0 && others === 0) {
      result.success = false;
      result.errorMessage = `This file has ${this.format.vendor}'s columns but no passwords in its rows, so nothing was imported.`;
      return Promise.resolve(result);
    }
    if (empty > 0) {
      (result.leftOut ??= []).push(`Left out ${empty} empty ${plural(empty, "row", "rows")}.`);
    }
    if (others > 0) {
      (result.leftOut ??= []).push(
        `Left out ${others} ${plural(others, "password", "passwords")} for other ${this.format.customer.many}.`,
      );
    }

    if (this.organization) {
      this.moveFoldersToCollections(result);
    }
    result.success = true;
    return Promise.resolve(result);
  }

  /** The file's header and rows, and which column holds what, or why it isn't this format's. */
  private read(data: string): Read | string {
    if (this.isNullOrWhitespace(data)) {
      return "The file is empty, so nothing was imported.";
    }
    const rows = this.parseCsv(data, false) as string[][] | null;
    if (rows == null || rows.length === 0) {
      return "The file has a quote that's never closed, so it can't be read.";
    }
    const header = rows[0].map((name) => (name ?? "").trim());
    const keys = new Set(header.map(columnKey));
    if (!this.format.recognizes(keys)) {
      const missing = missingColumns(this.format, keys);
      const why =
        missing.length > 0
          ? `it has no ${orList(missing)} ${plural(missing.length, "column", "columns")}`
          : `its columns aren't ${this.format.vendor}'s`;
      const other = this.otherFormat;
      const instead = other.recognizes(keys)
        ? `It looks like ${anExport(other)}: choose ${other.formatName} instead.`
        : this.format.hint;
      return `This isn't ${anExport(this.format)}: ${why}. ${instead}`;
    }

    // Each role's column: the likeliest name the header has, the first such column.
    const roles = new Map<MspColumnRole, number>();
    for (const role of ROLES) {
      for (const name of this.format.columns[role]) {
        const index = header.findIndex((h, i) => columnKey(h) === name && !this.claimed(roles, i));
        if (index >= 0) {
          roles.set(role, index);
          break;
        }
      }
    }
    return { header, rows: rows.slice(1), roles };
  }

  private claimed(roles: Map<MspColumnRole, number>, index: number): boolean {
    return [...roles.values()].includes(index);
  }

  private cell(read: Read, row: string[], role: MspColumnRole): string {
    const index = read.roles.get(role);
    return index == null ? "" : (row[index] ?? "");
  }

  private customerOf(read: Read, row: string[]): string {
    return this.cell(read, row, "customer").trim();
  }

  private isEmpty(row: string[]): boolean {
    return row.every((value) => this.isNullOrWhitespace(value));
  }

  private cipherOf(read: Read, row: string[]): CipherView {
    const value = (role: MspColumnRole) => this.getValueOrDefault(this.cell(read, row, role));
    const cipher = this.initLoginCipher();
    cipher.login.username = value("username");
    cipher.login.password = value("password");
    cipher.login.uris = this.makeUriArray(value("url")?.trim());
    cipher.login.totp = this.totpOf(value("totp")) ?? undefined;
    cipher.notes = value("notes") ?? "";

    const byKey = (key: string) => {
      const index = read.header.findIndex((h) => columnKey(h) === key);
      return index < 0 ? null : this.getValueOrDefault(row[index]);
    };
    const uri = cipher.login.uris?.[0]?.uri;
    cipher.name =
      value("name")?.trim() ||
      (uri ? this.nameFromUrl(uri) : null) ||
      this.format.nameFallbacks.map(byKey).find((name) => name != null) ||
      "--";

    // Every column the format doesn't map is a field, hidden unless it's on
    // the plain list, and so is anything past the header's last column.
    const mapped = new Set(read.roles.values());
    row.forEach((value, index) => {
      if (mapped.has(index) || this.isNullOrWhitespace(value)) {
        return;
      }
      const name = read.header[index] || `Column ${index + 1}`;
      const plain = index < read.header.length && this.format.plain.has(columnKey(name));
      const field = new FieldView();
      field.name = name;
      field.value = value;
      field.type = plain ? FieldType.Text : FieldType.Hidden;
      cipher.fields.push(field);
    });

    if (cipher.login.totp == null) {
      this.convertToNoteIfNeeded(cipher);
    }
    this.cleanupCipher(cipher);
    return cipher;
  }

  /** A one-time code secret as the vault keeps it: a bare secret without its spaces, or a link as it is. */
  private totpOf(value: string | null): string | null {
    const secret = value?.trim();
    if (secret == null || secret === "") {
      return null;
    }
    return /^[A-Za-z2-7=\s-]+$/.test(secret) ? secret.replace(/[\s-]/g, "").toUpperCase() : secret;
  }

  /** "Client/Folder", with the export's subfolders under it ("Admin//Firewall" is Admin, then Firewall). */
  private folderPath(customer: string, folder: string): string {
    return [customer, folder]
      .flatMap((part) => part.split(/[/\\]/))
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join("/");
  }
}
