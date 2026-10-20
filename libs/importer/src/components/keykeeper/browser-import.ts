// Keykeeper: guided import from a browser's own password manager. The person
// exports their passwords with the browser's own Export (we show the exact
// steps for their browser and computer), picks the file, and we import it
// with upstream's importer for that browser, leaving out what's already in
// their vault and setting aside logins whose password differs from the one
// they have. See DESIGN.md, "Browser import".

import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { ImportResult } from "../../models/import-result";

export type BrowserId = "chrome" | "edge" | "brave" | "firefox" | "safari";
export type Computer = "windows" | "mac" | "other";

export type BrowserGuide = {
  id: BrowserId;
  name: string;
  /** Upstream's importer for the browser's export. */
  format: "chromecsv" | "edgecsv" | "bravecsv" | "firefoxcsv" | "safaricsv";
  /** The browser's passwords page, for people to open or type in. */
  passwordsPage: string | null;
  /** The export, step by step. */
  steps: string[];
  /** The name the browser gives the file. */
  fileName: string;
  /** Turning the browser's own password saving off afterwards. */
  turnOff: string;
};

/** The browsers we guide, in the order offered. Safari only on a Mac. */
export function browsersFor(computer: Computer): BrowserId[] {
  return computer === "mac"
    ? ["chrome", "safari", "edge", "firefox", "brave"]
    : ["chrome", "edge", "firefox", "brave"];
}

/** The browser this is, from its user agent (and, for Brave, its brand list). */
export function detectBrowser(userAgent: string, brands: string[] = []): BrowserId {
  if (brands.some((b) => /brave/i.test(b))) {
    return "brave";
  }
  if (/\bEdg(e|A|iOS)?\//.test(userAgent)) {
    return "edge";
  }
  if (/\bFirefox\//.test(userAgent)) {
    return "firefox";
  }
  if (/\bSafari\//.test(userAgent) && !/(Chrome|Chromium|CriOS)\//.test(userAgent)) {
    return "safari";
  }
  return "chrome";
}

export function detectComputer(userAgent: string): Computer {
  if (/Windows/.test(userAgent)) {
    return "windows";
  }
  if (/Macintosh|Mac OS X/.test(userAgent)) {
    return "mac";
  }
  return "other";
}

const confirm = (computer: Computer) =>
  computer === "mac"
    ? "Confirm with Touch ID or your Mac's password."
    : computer === "windows"
      ? "Confirm with Windows Hello or your computer's password."
      : "Confirm with your computer's password if it asks.";

export function guideFor(browser: BrowserId, computer: Computer): BrowserGuide {
  switch (browser) {
    case "edge":
      return {
        id: "edge",
        name: "Microsoft Edge",
        format: "edgecsv",
        passwordsPage: "edge://wallet/passwords",
        steps: [
          "In Edge, open Settings, then Passwords (or type edge://wallet/passwords in the address bar).",
          "Choose More actions (…) next to Saved passwords, then Export passwords.",
          `Choose Export passwords again. ${confirm(computer)}`,
          "Save the file, Microsoft Edge Passwords.csv, somewhere you'll find it, such as Downloads.",
        ],
        fileName: "Microsoft Edge Passwords.csv",
        turnOff: "In Edge's Passwords settings, turn off Offer to save passwords.",
      };
    case "brave":
      return {
        id: "brave",
        name: "Brave",
        format: "bravecsv",
        passwordsPage: "brave://password-manager/settings",
        steps: [
          "In Brave, type brave://password-manager/settings in the address bar.",
          "Next to Export passwords, choose Download file.",
          confirm(computer),
          "Save the file, Brave Passwords.csv, somewhere you'll find it, such as Downloads.",
        ],
        fileName: "Brave Passwords.csv",
        turnOff: "In Brave's password manager settings, turn off Offer to save passwords.",
      };
    case "firefox":
      return {
        id: "firefox",
        name: "Firefox",
        format: "firefoxcsv",
        passwordsPage: "about:logins",
        steps: [
          "In Firefox, open the menu (☰), then Passwords (or type about:logins in the address bar).",
          "Choose the menu (…) at the top right, then Export passwords.",
          `Choose Continue with export. ${confirm(computer)}`,
          "Save the file, logins.csv, somewhere you'll find it, such as Downloads.",
        ],
        fileName: "logins.csv",
        turnOff: "In Firefox's Settings, Privacy & Security, turn off Ask to save passwords.",
      };
    case "safari":
      return {
        id: "safari",
        name: "Safari",
        format: "safaricsv",
        passwordsPage: null,
        steps: [
          "Open the Passwords app (in Applications). On macOS 14 or earlier, open Safari's Settings, then Passwords.",
          "Choose File, then Export All Passwords to File (in Safari: the … button, then Export All Passwords).",
          `Choose Continue. ${confirm("mac")}`,
          "Save the file, Passwords.csv, somewhere you'll find it, such as Downloads.",
        ],
        fileName: "Passwords.csv",
        turnOff: "In Safari's Settings, AutoFill, turn off User names and passwords.",
      };
    default:
      return {
        id: "chrome",
        name: "Google Chrome",
        format: "chromecsv",
        passwordsPage: "chrome://password-manager/settings",
        steps: [
          "In Chrome, open the menu (⋮), then Passwords and autofill, then Google Password Manager, then Settings (or type chrome://password-manager/settings in the address bar).",
          "Next to Export passwords, choose Download file.",
          confirm(computer),
          "Save the file, Chrome Passwords.csv, somewhere you'll find it, such as Downloads.",
        ],
        fileName: "Chrome Passwords.csv",
        turnOff: "In Google Password Manager's Settings, turn off Offer to save passwords.",
      };
  }
}

/** How to get rid of the export, which has every password in plain text. */
export function deleteSteps(fileName: string, computer: Computer): string {
  return computer === "mac"
    ? `Move ${fileName} to the Trash, then empty the Trash.`
    : computer === "windows"
      ? `Select ${fileName} and press Shift+Delete, so it skips the Recycle Bin.`
      : `Delete ${fileName}, and empty the trash if it goes there.`;
}

/** What an import will do, before anything is saved. */
export type PreparedImport = {
  /** What to import: new logins, with the ones to check in their own folder. */
  result: ImportResult;
  added: number;
  /** Already in the vault with the same password, or twice in the file. */
  alreadyThere: number;
  /** A different password from a login for the same site and username. */
  toCheck: number;
  /** Nothing to sign in with: no password. */
  empty: number;
};

/** The site a login is for: its first address's host, or its name. */
function siteOf(cipher: CipherView): string {
  const uri = cipher.login?.uris?.[0]?.uri ?? "";
  try {
    return new URL(uri).host.toLowerCase();
  } catch {
    return (uri || cipher.name || "").trim().toLowerCase();
  }
}

const keyOf = (cipher: CipherView) =>
  `${siteOf(cipher)}\u0000${(cipher.login?.username ?? "").trim().toLowerCase()}`;

/**
 * Sorts a parsed export against the vault: logins already there (same site,
 * username, and password) and repeats are left out, logins without a
 * password are skipped, and a login whose password differs from one the
 * person already has for that site and username goes into `checkFolder`,
 * imported, for them to compare.
 */
export function prepareImport(
  parsed: ImportResult,
  existing: CipherView[],
  checkFolder: string,
): PreparedImport {
  const known = new Map<string, Set<string>>();
  const remember = (cipher: CipherView) => {
    const key = keyOf(cipher);
    const passwords = known.get(key) ?? new Set<string>();
    passwords.add(cipher.login?.password ?? "");
    known.set(key, passwords);
  };
  existing.filter((c) => c.type === CipherType.Login && !c.isDeleted).forEach((c) => remember(c));

  const result = new ImportResult();
  result.success = parsed.success;
  result.errorMessage = parsed.errorMessage;
  result.errors = parsed.errors;
  const prepared: PreparedImport = { result, added: 0, alreadyThere: 0, toCheck: 0, empty: 0 };
  let checkIndex = -1;
  for (const cipher of parsed.ciphers) {
    if (cipher.type !== CipherType.Login) {
      continue;
    }
    const password = cipher.login?.password ?? "";
    if (password === "") {
      prepared.empty++;
      continue;
    }
    const passwords = known.get(keyOf(cipher));
    if (passwords?.has(password)) {
      prepared.alreadyThere++;
      continue;
    }
    result.ciphers.push(cipher);
    if (passwords != null) {
      if (checkIndex < 0) {
        const folder = new FolderView();
        folder.name = checkFolder;
        checkIndex = result.folders.push(folder) - 1;
      }
      result.folderRelationships.push([result.ciphers.length - 1, checkIndex]);
      prepared.toCheck++;
    } else {
      prepared.added++;
    }
    remember(cipher);
  }
  return prepared;
}
