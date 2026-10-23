// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { CipherType, FieldType, SecureNoteType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { SecureNoteView } from "@bitwarden/common/vault/models/view/secure-note.view";

import { ImportResult } from "../models/import-result";

import { BaseImporter } from "./base-importer";
import { Importer } from "./importer";

export class KeePass2XmlImporter extends BaseImporter implements Importer {
  result = new ImportResult();
  /** Keykeeper: the Recycle Bin group's UUID, if the database has one. */
  private recycleBin: string | null = null;

  parse(data: string): Promise<ImportResult> {
    const doc = this.parseXml(data);
    if (doc == null) {
      this.result.success = false;
      return Promise.resolve(this.result);
    }

    //Note: The doc.querySelector("KeePassFile > Root > Group") no longer works on node and we have to breakdown the query by nodes
    const KeePassFileNode = doc.querySelector("KeePassFile");

    if (KeePassFileNode == null) {
      this.result.errorMessage = "Missing `KeePassFile` node.";
      this.result.success = false;
      return Promise.resolve(this.result);
    }

    const RootNode = KeePassFileNode.querySelector("Root");
    if (RootNode == null) {
      this.result.errorMessage = "Missing `KeePassFile > Root` node.";
      this.result.success = false;
      return Promise.resolve(this.result);
    }

    const rootGroup = RootNode.querySelector("Group");
    if (rootGroup == null) {
      this.result.errorMessage = "Missing `KeePassFile > Root > Group` node.";
      this.result.success = false;
      return Promise.resolve(this.result);
    }

    // Keykeeper: KeePass exports its Recycle Bin too. What's in it was deleted, so it's
    // left out rather than coming back as a "Recycle Bin" folder.
    const meta = this.querySelectorDirectChild(KeePassFileNode, "Meta");
    const recycleBin = meta == null ? null : this.querySelectorDirectChild(meta, "RecycleBinUUID");
    const noUuid = "AAAAAAAAAAAAAAAAAAAAAA==";
    this.recycleBin =
      recycleBin == null || this.isNullOrWhitespace(recycleBin.textContent)
        ? null
        : recycleBin.textContent.trim();
    if (this.recycleBin === noUuid) {
      this.recycleBin = null;
    }

    this.traverse(rootGroup, true, "");

    if (this.organization) {
      this.moveFoldersToCollections(this.result);
    }

    this.result.success = true;
    return Promise.resolve(this.result);
  }

  traverse(node: Element, isRootNode: boolean, groupPrefixName: string) {
    const folderIndex = this.result.folders.length;
    let groupName = groupPrefixName;

    if (!isRootNode) {
      if (groupName !== "") {
        groupName += "/";
      }
      const nameEl = this.querySelectorDirectChild(node, "Name");
      groupName += nameEl == null ? "-" : nameEl.textContent;
      const folder = new FolderView();
      folder.name = groupName;
      this.result.folders.push(folder);
    }

    this.querySelectorAllDirectChild(node, "Entry").forEach((entry) => {
      const cipherIndex = this.result.ciphers.length;

      const cipher = this.initLoginCipher();
      const strings: KeePassString[] = [];
      this.querySelectorAllDirectChild(entry, "String").forEach((entryString) => {
        const valueEl = this.querySelectorDirectChild(entryString, "Value");
        const value = valueEl != null ? valueEl.textContent : null;
        if (this.isNullOrWhitespace(value)) {
          return;
        }
        const keyEl = this.querySelectorDirectChild(entryString, "Key");
        const key = keyEl != null ? keyEl.textContent : null;
        const attrs = valueEl.attributes as any;
        const isProtected =
          attrs.length > 0 &&
          attrs.ProtectInMemory != null &&
          attrs.ProtectInMemory.value === "True";
        strings.push({ key, value, isProtected });
      });

      // Keykeeper: KeePass's own TOTP fields (and the older plugins' ones) are the
      // item's TOTP, not hidden fields.
      const totp = keePassTotp(strings);
      let notes: string = null;
      let mainUri: string = null;
      const moreUris: string[] = [];

      strings.forEach(({ key, value, isProtected }) => {
        if (totp?.keys.has(key)) {
          return;
        }
        if (key === "URL") {
          mainUri = value;
        } else if (moreUriKey.test(key)) {
          // Keykeeper: more websites, the way KeePass2Android and KeePassXC keep them.
          moreUris.push(value);
        } else if (key === "UserName") {
          cipher.login.username = value;
        } else if (key === "Password") {
          cipher.login.password = value;
        } else if (key === "Title") {
          cipher.name = value;
        } else if (key === "Notes") {
          // Keykeeper: the notes as they were, with no line break added at the end.
          notes = value;
        } else if (isProtected) {
          // Protected fields should always be imported as hidden fields,
          // regardless of length or newlines (fixes #16897)
          if (cipher.fields == null) {
            cipher.fields = [];
          }
          const field = new FieldView();
          field.type = FieldType.Hidden;
          field.name = key;
          field.value = value;
          cipher.fields.push(field);
        } else {
          this.processKvp(cipher, key, value, FieldType.Text);
        }
      });

      const uris = [mainUri, ...moreUris].filter(
        (uri, i, all) => uri != null && all.indexOf(uri) === i,
      );
      cipher.login.uris = this.makeUriArray(uris);
      if (totp != null) {
        cipher.login.totp = totp.value(cipher.name, cipher.login.username);
      }
      if (notes != null) {
        // What processKvp moved to the notes comes after the entry's own notes.
        cipher.notes = this.isNullOrWhitespace(cipher.notes) ? notes : notes + "\n" + cipher.notes;
      }
      this.convertToNoteIfEmpty(cipher);

      this.cleanupCipher(cipher);
      this.result.ciphers.push(cipher);

      if (!isRootNode) {
        this.result.folderRelationships.push([cipherIndex, folderIndex]);
      }
    });

    this.querySelectorAllDirectChild(node, "Group").forEach((group) => {
      if (
        this.recycleBin != null &&
        this.querySelectorDirectChild(group, "UUID")?.textContent.trim() === this.recycleBin
      ) {
        return;
      }
      this.traverse(group, false, groupName);
    });
  }

  /**
   * Keykeeper: KeePass has only entries, so a secure note or a card kept there is an
   * entry with nothing to sign in with. Those come over as secure notes, their fields
   * and notes kept; an entry with a TOTP stays a login.
   */
  private convertToNoteIfEmpty(cipher: CipherView) {
    if (
      this.isNullOrWhitespace(cipher.login.username) &&
      this.isNullOrWhitespace(cipher.login.password) &&
      this.isNullOrWhitespace(cipher.login.totp) &&
      (cipher.login.uris == null || cipher.login.uris.length === 0)
    ) {
      cipher.type = CipherType.SecureNote;
      cipher.secureNote = new SecureNoteView();
      cipher.secureNote.type = SecureNoteType.Generic;
    }
  }
}

type KeePassString = { key: string; value: string; isProtected: boolean };

/** KP2A_URL, KP2A_URL_1, and so on; and fields named like "URL 2", "URL2", or "URL_2". */
const moreUriKey = /^(KP2A_URL(_\d+)?|URL[ _-]?\(?\d+\)?)$/i;

const totpDefaults = { algorithm: "SHA1", digits: 6, period: 30 };

/**
 * Keykeeper: an entry's TOTP, from the fields KeePass 2.47 and later keep it in
 * (TimeOtp-Secret-Base32, TimeOtp-Secret, TimeOtp-Secret-Hex, or TimeOtp-Secret-Base64,
 * with TimeOtp-Period, TimeOtp-Length, and TimeOtp-Algorithm), from KeeOtp's and
 * KeePassXC's "otp" field ("key=...&step=30&size=6", or an otpauth:// URI), or from
 * TrayTOTP's "TOTP Seed" and "TOTP Settings". The secret alone when everything else is
 * the default, otherwise an otpauth:// URI. Null when there's none, or when it's in a
 * form we can't read, so the fields come over as they were.
 */
export function keePassTotp(
  strings: { key: string; value: string }[],
): { keys: Set<string>; value: (title: string, username: string) => string } | null {
  const get = (key: string) => strings.find((s) => s.key === key)?.value?.trim();

  // KeePass 2.47 and later.
  const encodings: [string, string][] = [
    ["TimeOtp-Secret-Base32", "base32"],
    ["TimeOtp-Secret", "utf8"],
    ["TimeOtp-Secret-Hex", "hex"],
    ["TimeOtp-Secret-Base64", "base64"],
  ];
  const timeOtp = encodings.find(([key]) => get(key) != null);
  if (timeOtp != null) {
    const [key, encoding] = timeOtp;
    const secret = base32Secret(get(key), encoding);
    const algorithm = totpAlgorithm(get("TimeOtp-Algorithm"));
    const digits = whole(get("TimeOtp-Length"), totpDefaults.digits);
    const period = whole(get("TimeOtp-Period"), totpDefaults.period);
    if (secret == null || algorithm == null || digits == null || period == null) {
      return null;
    }
    const keys = new Set(["TimeOtp-Algorithm", "TimeOtp-Length", "TimeOtp-Period"]);
    encodings.forEach(([k]) => keys.add(k));
    return {
      keys,
      value: (title, username) => totpValue(secret, algorithm, digits, period, title, username),
    };
  }

  // KeeOtp and KeePassXC.
  const otp = get("otp");
  if (otp != null) {
    if (/^otpauth:\/\/totp\//i.test(otp) || /^steam:\/\//i.test(otp)) {
      return { keys: new Set(["otp"]), value: () => otp };
    }
    const params = new Map<string, string>();
    for (const part of otp.split("&")) {
      const eq = part.indexOf("=");
      if (eq > 0) {
        params.set(part.substring(0, eq).trim().toLowerCase(), decodeParam(part.substring(eq + 1)));
      }
    }
    const type = params.get("type");
    if (params.get("key") == null || (type != null && type.toLowerCase() !== "totp")) {
      return null;
    }
    const secret = base32Secret(
      params.get("key"),
      (params.get("encoding") ?? "base32").toLowerCase(),
    );
    const algorithm = totpAlgorithm(params.get("otphashmode"));
    const digits = whole(params.get("size"), totpDefaults.digits);
    const period = whole(params.get("step"), totpDefaults.period);
    if (secret == null || algorithm == null || digits == null || period == null) {
      return null;
    }
    return {
      keys: new Set(["otp"]),
      value: (title, username) => totpValue(secret, algorithm, digits, period, title, username),
    };
  }

  // TrayTOTP: "TOTP Seed", and "TOTP Settings" as "period;digits", with "S" for Steam.
  const seed = get("TOTP Seed");
  if (seed != null) {
    const secret = base32Secret(seed, "base32");
    const [periodSetting, digitsSetting] = (get("TOTP Settings") ?? "").split(";");
    const period = whole(periodSetting, totpDefaults.period);
    if (secret == null || period == null) {
      return null;
    }
    const keys = new Set(["TOTP Seed", "TOTP Settings"]);
    if (digitsSetting?.trim().toUpperCase() === "S") {
      return { keys, value: () => "steam://" + secret };
    }
    const digits = whole(digitsSetting, totpDefaults.digits);
    if (digits == null) {
      return null;
    }
    return {
      keys,
      value: (title, username) => totpValue(secret, "SHA1", digits, period, title, username),
    };
  }

  return null;
}

function totpValue(
  secret: string,
  algorithm: string,
  digits: number,
  period: number,
  title: string,
  username: string,
): string {
  if (
    algorithm === totpDefaults.algorithm &&
    digits === totpDefaults.digits &&
    period === totpDefaults.period
  ) {
    return secret;
  }
  const issuer = Utils.isNullOrWhitespace(title) ? "KeePass" : title.trim();
  const label = Utils.isNullOrWhitespace(username)
    ? encodeURIComponent(issuer)
    : `${encodeURIComponent(issuer)}:${encodeURIComponent(username.trim())}`;
  return (
    `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=${algorithm}&digits=${digits}&period=${period}`
  );
}

/** "HMAC-SHA-256", "Sha256", "SHA256", and so on; SHA-1 when there's none. */
function totpAlgorithm(value: string | undefined): string | null {
  if (Utils.isNullOrWhitespace(value)) {
    return totpDefaults.algorithm;
  }
  const name = value
    .toUpperCase()
    .replace(/^HMAC/, "")
    .replace(/[^A-Z0-9]/g, "");
  return ["SHA1", "SHA256", "SHA512"].includes(name) ? name : null;
}

/** A positive whole number, the default when there's none, or null when it isn't one. */
function whole(value: string | undefined, defaultValue: number): number | null {
  if (Utils.isNullOrWhitespace(value)) {
    return defaultValue;
  }
  return /^\d+$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null;
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).trim();
  } catch {
    return value.trim();
  }
}

/** The secret in base32, from the encoding it was kept in; null when it isn't valid. */
function base32Secret(value: string | undefined, encoding: string): string | null {
  if (Utils.isNullOrWhitespace(value)) {
    return null;
  }
  switch (encoding) {
    case "base32": {
      const secret = value.replace(/[\s=-]/g, "").toUpperCase();
      return /^[A-Z2-7]+$/.test(secret) ? secret : null;
    }
    case "hex": {
      const hex = value.replace(/\s/g, "");
      return /^([0-9a-f]{2})+$/i.test(hex) ? toBase32(Utils.fromHexToArray(hex)) : null;
    }
    case "base64": {
      const b64 = value.replace(/\s/g, "");
      return /^[A-Za-z0-9+/]+={0,2}$/.test(b64) ? toBase32(Utils.fromB64ToArray(b64)) : null;
    }
    case "utf8":
    case "utf-8":
      return toBase32(Utils.fromUtf8ToArray(value));
    default:
      return null;
  }
}

/** RFC 4648 base32, without padding, the way authenticator apps take a secret. */
function toBase32(bytes: Uint8Array): string | null {
  if (bytes == null || bytes.length === 0) {
    return null;
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  let bits = 0;
  let buffer = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) {
    out += alphabet[(buffer << (5 - bits)) & 31];
  }
  return out;
}
