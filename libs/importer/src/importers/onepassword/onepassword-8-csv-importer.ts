// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { ImportResult } from "../../models/import-result";
import { BaseImporter } from "../base-importer";
import { Importer } from "../importer";

/** The columns 1Password 8 writes, lowercase, and the ones it may write instead. */
const columns = {
  title: ["title"],
  url: ["url", "website", "urls"],
  username: ["username"],
  password: ["password"],
  totp: ["otpauth", "one-time password", "otp"],
  favorite: ["favorite"],
  archived: ["archived"],
  tags: ["tags"],
  notes: ["notes", "notesplain"],
};
const mapped = new Set(Object.values(columns).flat());

/**
 * Keykeeper: 1Password 8's CSV export (File, Export, CSV). Only logins and passwords, with
 * the columns Title, Url, Username, Password, OTPAuth, Favorite, Archived, Tags, Notes, and
 * standard CSV quoting: a quote inside a value is two quotes. The one-time password is the
 * TOTP, a favorite is a favorite, an archived item is archived, the first tag is the
 * folder (with every tag in the notes when there's more than one), and a column it doesn't
 * know is a field. The 1Password 6 and 7 importers read their own CSVs, which quote
 * differently.
 */
export class OnePassword8CsvImporter extends BaseImporter implements Importer {
  parse(data: string): Promise<ImportResult> {
    const result = new ImportResult();
    const rows = this.parseCsv(data, true);
    if (rows == null) {
      result.success = false;
      return Promise.resolve(result);
    }

    rows.forEach((row: Record<string, string>) => {
      const values = new Map<string, string>();
      Object.entries(row).forEach(([column, value]) => {
        if (column != null && typeof value === "string") {
          values.set(column.trim().toLowerCase(), value);
        }
      });
      const get = (names: string[]) => {
        const name = names.find((n) => !this.isNullOrWhitespace(values.get(n)));
        return name == null ? null : values.get(name);
      };
      if ([...values.values()].every((v) => this.isNullOrWhitespace(v))) {
        return;
      }

      const cipher = this.initLoginCipher();
      const url = get(columns.url);
      cipher.login.uris = url == null ? null : this.makeUriArray(this.splitNewLine(url));
      cipher.login.username = this.getValueOrDefault(get(columns.username));
      cipher.login.password = this.getValueOrDefault(get(columns.password));
      cipher.login.totp = this.getValueOrDefault(get(columns.totp)?.trim());
      cipher.name =
        this.getValueOrDefault(get(columns.title)) ??
        (url == null ? null : this.nameFromUrl(cipher.login.uris?.[0]?.uri)) ??
        "--";
      cipher.notes = this.getValueOrDefault(get(columns.notes), "");
      cipher.favorite = !this.organization && this.isTrue(get(columns.favorite));

      // Columns 1Password may add later come over as fields.
      Object.entries(row).forEach(([column, value]) => {
        if (
          column == null ||
          typeof value !== "string" ||
          mapped.has(column.trim().toLowerCase())
        ) {
          return;
        }
        const lower = column.toLowerCase();
        const hidden = ["password", "secret", "key"].some((word) => lower.includes(word));
        this.processKvp(cipher, column, value, hidden ? FieldType.Hidden : FieldType.Text);
      });

      const tags = this.tags(get(columns.tags));
      if (tags.length > 1) {
        this.addNotesLine(cipher, "Tags: " + tags.join(", "));
      }

      this.convertToNoteIfEmpty(cipher);
      this.cleanupCipher(cipher);
      if (tags.length > 0) {
        this.processFolder(result, tags[0]);
      }
      // As the 1PUX importer does: 1Password says an item is archived, not when.
      if (this.isTrue(get(columns.archived))) {
        cipher.archivedDate = new Date();
      }
      result.ciphers.push(cipher);
    });

    if (this.organization) {
      this.moveFoldersToCollections(result);
    }

    result.success = true;
    return Promise.resolve(result);
  }

  private isTrue(value: string | null): boolean {
    return value != null && /^(true|yes|1)$/i.test(value.trim());
  }

  /** Tags, separated by commas (or semicolons, or one to a line). */
  private tags(value: string | null): string[] {
    if (this.isNullOrWhitespace(value)) {
      return [];
    }
    return value
      .split(/[,;\n]/)
      .map((tag) => tag.trim())
      .filter((tag, i, all) => tag !== "" && all.indexOf(tag) === i);
  }

  private addNotesLine(cipher: CipherView, line: string) {
    if (cipher.notes.length > 0 && !cipher.notes.endsWith("\n")) {
      cipher.notes += "\n";
    }
    cipher.notes += line;
  }

  /** A login with nothing to sign in with is a secure note; a TOTP is something. */
  private convertToNoteIfEmpty(cipher: CipherView) {
    if (this.isNullOrWhitespace(cipher.login.totp)) {
      this.convertToNoteIfNeeded(cipher);
    }
  }
}
