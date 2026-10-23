import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { visibleCustomFields } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

/**
 * Keykeeper: printing an item from the web vault, for people whose shared
 * folders let them print it (DESIGN.md, "Folders and permissions"). Print
 * needs see passwords, so passwords print. Machine secrets that nobody types
 * from paper stay off it: a login's one-time code key and an SSH private key.
 * PassBundle's own fields (keykeeper.*) never print.
 */

type Translate = (key: string) => string;

/** The item's fields as label and value, in the item view's order. */
export function printableFields(cipher: CipherView, t: Translate): [string, string][] {
  const rows: [string, string | null | undefined][] = [];
  switch (cipher.type) {
    case CipherType.Login:
      rows.push([t("username"), cipher.login?.username]);
      rows.push([t("password"), cipher.login?.password]);
      for (const uri of cipher.login?.uris ?? []) {
        rows.push([t("website"), uri.uri]);
      }
      break;
    case CipherType.Card:
      rows.push([t("cardholderName"), cipher.card?.cardholderName]);
      rows.push([t("brand"), cipher.card?.brand]);
      rows.push([t("number"), cipher.card?.number]);
      rows.push([
        t("expiration"),
        [cipher.card?.expMonth, cipher.card?.expYear].filter((p) => !!p).join(" / "),
      ]);
      rows.push([t("securityCode"), cipher.card?.code]);
      break;
    case CipherType.Identity: {
      const id = cipher.identity;
      rows.push([
        t("fullName"),
        [id?.title, id?.firstName, id?.middleName, id?.lastName].filter((p) => !!p).join(" "),
      ]);
      rows.push([t("username"), id?.username]);
      rows.push([t("company"), id?.company]);
      rows.push([t("ssn"), id?.ssn]);
      rows.push([t("passportNumber"), id?.passportNumber]);
      rows.push([t("licenseNumber"), id?.licenseNumber]);
      rows.push([t("email"), id?.email]);
      rows.push([t("phone"), id?.phone]);
      rows.push([
        t("address"),
        [
          id?.address1,
          id?.address2,
          id?.address3,
          [id?.city, id?.state, id?.postalCode].filter((p) => !!p).join(" "),
          id?.country,
        ]
          .filter((p) => !!p)
          .join("\n"),
      ]);
      break;
    }
    case CipherType.SshKey:
      rows.push([t("fingerprint"), cipher.sshKey?.keyFingerprint]);
      break;
  }
  for (const field of visibleCustomFields(cipher.fields)) {
    if (field.type === FieldType.Linked) {
      continue;
    }
    rows.push([field.name ?? "", field.value]);
  }
  rows.push([t("notes"), cipher.notes]);
  return rows.filter((row): row is [string, string] => row[1] != null && row[1] !== "");
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** A plain page with the item, for the browser's print dialog. */
export function printableItem(cipher: CipherView, t: Translate): string {
  const rows = printableFields(cipher, t)
    .map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`)
    .join("");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<title>${escape(cipher.name ?? "")}</title>`,
    "<style>body{font:14px/1.4 system-ui,sans-serif;margin:2rem;color:#000}",
    "h1{font-size:20px;margin:0 0 1rem}dt{font-weight:600;margin-top:.6rem}",
    "dd{margin:0;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,monospace}</style>",
    `</head><body><h1>${escape(cipher.name ?? "")}</h1><dl>${rows}</dl></body></html>`,
  ].join("");
}

/** Opens the page in a new window and asks the browser to print it. */
export function printItem(cipher: CipherView, t: Translate, win: Window = window): void {
  const page = win.open();
  if (page == null) {
    return;
  }
  page.document.open();
  page.document.write(printableItem(cipher, t));
  page.document.close();
  page.focus();
  page.print();
}
