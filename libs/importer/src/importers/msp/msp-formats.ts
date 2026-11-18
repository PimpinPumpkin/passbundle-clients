// Keykeeper: the columns of the two password managers MSPs move from, N-able
// Passportal and Kaseya IT Glue. Neither publishes the columns of its export,
// and there are no sample files, so each format here comes from the vendor's
// public help on exporting and on importing the same data (which names the
// fields its own export carries), and nothing else. Which columns are sure and
// which are guessed is in DESIGN.md, "Importing from other password managers",
// with the pages. Columns are matched by name, loosely (`columnKey`), so a
// header written "Client Name", "client_name", or "CLIENT NAME" is the same.
//
// The pages, read November 2026:
// - Passportal: documentation.n-able.com/passportal/userguide/Content/
//   imp-exp-data/exp-pass-data-csv.htm (the export and its options),
//   imp-exp-data/imp-pass-csv.htm (the Passwords import template),
//   imp-exp-data/my_vault_import.htm (My Vault's template, its columns in
//   order), imp-exp-data/import-templates.htm (the documentation importer's
//   credentials.csv: imported_id, rotation_policy), and
//   site/site-end-admin-user-create-folders.htm (a password's fields).
// - IT Glue: help.itglue.kaseya.com/help/Content/
//   1-admin/import-and-export/exporting-and-backing-up-account-data.html (the
//   export, and the OTP secret in passwords.csv),
//   1-admin/import-and-export/importing-passwords.html (otp_secret, and the id
//   and organization columns to ignore),
//   1-admin/import-and-export/file-import-and-matching-guide.html (every
//   password field's name), 1-admin/import-and-export/exporting-from-list-view.html,
//   and 2-using/documentation-guide/passwords.html (the screens' names).

/** What a column holds, for the columns a format maps onto the item. */
export type MspColumnRole =
  "name" | "username" | "password" | "url" | "notes" | "totp" | "customer" | "folder";

export interface MspFormat {
  /** The vendor, as people call it: "Passportal". */
  vendor: string;
  /** The format's name in the format list. */
  formatName: string;
  /** What the vendor calls the MSP's customers. */
  customer: { one: string; many: string };
  /** For each role, the names its column may have, as `columnKey` writes them, the likeliest first. */
  columns: Readonly<Record<MspColumnRole, readonly string[]>>;
  /**
   * The other columns known to be plain, as `columnKey` writes them. Every
   * other column the format doesn't map becomes a hidden field: a value is a
   * secret unless it's on the plain list, the rule the apps use
   * (libs/common/src/vault/keykeeper/hidden-secrets.ts).
   */
  plain: ReadonlySet<string>;
  /** Columns that name the item when its name column is empty and it has no website. */
  nameFallbacks: readonly string[];
  /** The columns the error names when a file doesn't have them: as the vendor writes them, and their role or key. */
  expected: readonly (readonly [label: string, roleOrKey: string])[];
  /** Whether a header row, as keys, is this format's. */
  recognizes(keys: ReadonlySet<string>): boolean;
  /** What to do about a file that isn't this format's and isn't the other's either. */
  hint: string;
}

/** A column's name as it's compared: lowercase letters and digits, leaving out anything in parentheses. */
export function columnKey(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/\([^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Whether the keys have a column for this role, or one of these keys. */
function has(format: MspFormat, keys: ReadonlySet<string>, roleOrKey: string): boolean {
  const names = Object.prototype.hasOwnProperty.call(format.columns, roleOrKey)
    ? format.columns[roleOrKey as MspColumnRole]
    : [roleOrKey];
  return names.some((name) => keys.has(name));
}

/**
 * N-able Passportal: Settings, Import / Export, Export, Passwords (or My
 * Vault), with headers. The fields are those of its password import
 * templates, which name the same data: Passportal ID, Client Name,
 * Credential Type (the vault's says Credential), Username, Password,
 * Description (what password lists show, so the item's name), Expires
 * (Yes/No), Notes, URL, Folder (subfolders written "Admin//Firewall"), and
 * TOTP Secret. My Vault's export has no client.
 */
export const PASSPORTAL: MspFormat = {
  vendor: "Passportal",
  formatName: "Passportal (csv)",
  customer: { one: "client", many: "clients" },
  columns: {
    name: ["description"],
    username: ["username"],
    password: ["password"],
    url: ["url", "website"],
    notes: ["notes", "note"],
    totp: ["totpsecret", "totp"],
    customer: ["clientname", "client"],
    folder: ["folder"],
  },
  // The import templates' own columns. "imported_id" and "rotation_policy" are
  // its documentation importer's names for the ID and Expires.
  plain: new Set([
    "passportalid",
    "importedid",
    "credentialtype",
    "credential",
    "expires",
    "rotationpolicy",
  ]),
  nameFallbacks: ["credentialtype", "credential", "username"],
  expected: [
    ["Client Name", "customer"],
    ["Credential Type", "credentialtype"],
    ["Description", "name"],
    ["Password", "password"],
  ],
  recognizes(keys) {
    return (
      has(this, keys, "password") &&
      (["credentialtype", "credential", "passportalid"].some((key) => keys.has(key)) ||
        (has(this, keys, "name") && has(this, keys, "customer")))
    );
  },
  hint: "If it came from Passportal, export it again with Include headers checked.",
};

/**
 * Kaseya IT Glue: Admin, Export Data, for an organization or the entire
 * account, unzipped: its passwords.csv. Its columns are the password
 * importer's fields, which IT Glue's help names in lowercase: organization,
 * name, username, password, url, notes, password_category, otp_secret, and
 * for passwords embedded in a configuration, configuration_name,
 * resource_type, and resource_id; the importer says to ignore the id and
 * organization columns an export brings. A password folder column is a
 * guess: IT Glue has password folders, but its help doesn't say how an
 * export writes them.
 */
export const IT_GLUE: MspFormat = {
  vendor: "IT Glue",
  formatName: "IT Glue (csv)",
  customer: { one: "IT Glue organization", many: "IT Glue organizations" },
  columns: {
    // IT Glue's screens call the name Description, so a list view's export may too.
    name: ["name", "description"],
    username: ["username"],
    password: ["password"],
    url: ["url"],
    notes: ["notes"],
    totp: ["otpsecret", "onetimepassword", "otp"],
    customer: ["organization", "organizationname"],
    folder: ["passwordfolder", "passwordfoldername", "folder"],
  },
  plain: new Set([
    "id",
    "passwordcategory",
    "passwordcategoryname",
    "category",
    "configurationname",
    "resourcetype",
    "resourceid",
    "description",
  ]),
  nameFallbacks: [],
  expected: [
    ["organization", "customer"],
    ["name", "name"],
    ["password", "password"],
    ["password_category", "passwordcategory"],
  ],
  recognizes(keys) {
    return (
      has(this, keys, "password") &&
      has(this, keys, "name") &&
      (has(this, keys, "customer") ||
        [
          "passwordcategory",
          "category",
          "otpsecret",
          "configurationname",
          "resourcetype",
          "resourceid",
        ].some((key) => keys.has(key)))
    );
  },
  hint: "If it came from IT Glue, choose the passwords.csv file in its export.",
};

/** Why a header row isn't this format's: the expected columns it doesn't have. */
export function missingColumns(format: MspFormat, keys: ReadonlySet<string>): string[] {
  return format.expected
    .filter(([, roleOrKey]) => !has(format, keys, roleOrKey))
    .map(([label]) => label);
}

/** "A", "A or B", "A, B, or C". */
export function orList(items: readonly string[]): string {
  if (items.length <= 2) {
    return items.join(" or ");
  }
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}
