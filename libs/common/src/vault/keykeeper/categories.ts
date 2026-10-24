// Keykeeper: every kind of item has a color and a glyph, the same wherever it
// shows (DESIGN.md, "The look", in the keykeeper repo). The colors are jewel
// tones, deep enough for a white glyph on them (3:1 or more, light and dark),
// drawn as a rounded tile with a little sheen. The extension's popup and the
// fill menu it draws inside websites both read them from here.
//
// Templates bring their own color where one fits (Wi-Fi, servers, licenses);
// the rest show the kind of item they're based on.

import { CipherType } from "../enums/cipher-type";

import { templateOf } from "./templates";

export type KeykeeperCategory =
  | "all"
  | "login"
  | "note"
  | "card"
  | "identity"
  | "sshKey"
  | "bank"
  | "wifi"
  | "server"
  | "license"
  | "apiKey"
  | "domain"
  | "email"
  | "certificate";

export type KeykeeperCategoryLook = {
  /** The tile's color on light backgrounds. */
  light: string;
  /** On dark backgrounds, a step lighter, so the tile still reads as a stone. */
  dark: string;
  /** The glyph: SVG path data on a 24 by 24 grid, stroked in white. */
  glyph: string;
};

const glyphs = {
  grid: "M4 4h7v7H4Z M13 4h7v7h-7Z M4 13h7v7H4Z M13 13h7v7h-7Z",
  key: "M8 14a4 4 0 1 1 3.87-5H21v3h-2v3h-3v-3h-4.13A4 4 0 0 1 8 14Z M7 10h.01",
  note: "M6 3h9l4 4v14H6Z M14 3v5h5 M9 12h7 M9 16h5",
  card: "M3 6h18v12H3Z M3 10h18 M7 15h4",
  identity:
    "M4 5h16v14H4Z M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M5.5 16c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8 M14 9h4 M14 13h4",
  terminal: "M3 5h18v14H3Z M7 10l3 2-3 2 M12 15h5",
  bank: "M3 9l9-5 9 5 M5 10v7 M9.5 10v7 M14.5 10v7 M19 10v7 M3 20h18",
  wifi: "M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01",
  server: "M4 4h16v6H4Z M4 14h16v6H4Z M8 7h.01 M8 17h.01",
  license: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z M9 8h6 M9 12h6",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z",
  envelope: "M3 6h18v12H3Z M3 7l9 6 9-6",
  badge: "M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M8.6 12.6 7 21l5-2.6 5 2.6-1.6-8.4",
};

export const KEYKEEPER_CATEGORY_LOOKS: Readonly<Record<KeykeeperCategory, KeykeeperCategoryLook>> =
  {
    // Emerald, the logo's color: "everything".
    all: { light: "#0E7A5A", dark: "#0E7A5A", glyph: glyphs.grid },
    // Sapphire.
    login: { light: "#2448B8", dark: "#2E55C9", glyph: glyphs.key },
    // Topaz.
    note: { light: "#A9600C", dark: "#B4690F", glyph: glyphs.note },
    // Amethyst.
    card: { light: "#6B30B8", dark: "#7A42CC", glyph: glyphs.card },
    // Turquoise.
    identity: { light: "#08788A", dark: "#0A8599", glyph: glyphs.identity },
    // Onyx.
    sshKey: { light: "#353B4A", dark: "#4A5266", glyph: glyphs.terminal },
    // Emerald, a bank's.
    bank: { light: "#0E7A47", dark: "#128752", glyph: glyphs.bank },
    // Aquamarine.
    wifi: { light: "#1C7FB8", dark: "#1F86C2", glyph: glyphs.wifi },
    // Garnet.
    server: { light: "#A8291F", dark: "#B83328", glyph: glyphs.server },
    // Ruby.
    license: { light: "#B01E54", dark: "#C0275F", glyph: glyphs.license },
    apiKey: { light: "#353B4A", dark: "#4A5266", glyph: glyphs.key },
    domain: { light: "#1C7FB8", dark: "#1F86C2", glyph: glyphs.globe },
    email: { light: "#2448B8", dark: "#2E55C9", glyph: glyphs.envelope },
    certificate: { light: "#B01E54", dark: "#C0275F", glyph: glyphs.badge },
  };

/** A login without a site icon shows its first letter on a tint of the login color. */
export const KEYKEEPER_LETTER_TINT = {
  light: { background: "#E3E9F8", letter: "#1D3C99" },
  dark: { background: "#1C2A4A", letter: "#9DB4F2" },
} as const;

const TEMPLATE_CATEGORIES: Readonly<Record<string, KeykeeperCategory>> = {
  "api-key": "apiKey",
  server: "server",
  database: "server",
  wifi: "wifi",
  router: "wifi",
  "software-license": "license",
  domain: "domain",
  certificate: "certificate",
  "email-account": "email",
  membership: "identity",
};

const TYPE_CATEGORIES: Readonly<Record<CipherType, KeykeeperCategory>> = {
  [CipherType.Login]: "login",
  [CipherType.SecureNote]: "note",
  [CipherType.Card]: "card",
  [CipherType.Identity]: "identity",
  [CipherType.SshKey]: "sshKey",
  [CipherType.BankAccount]: "bank",
  [CipherType.DriversLicense]: "identity",
  [CipherType.Passport]: "identity",
};

/** The category of an item type, for a filter or a picker. */
export function categoryOfType(type: CipherType | null | undefined): KeykeeperCategory {
  return (type != null && TYPE_CATEGORIES[type]) || "all";
}

/**
 * The category an item shows as: its built-in template's, if it came from one
 * that has its own, otherwise its type's.
 */
export function categoryOfItem(item: {
  type: CipherType;
  fields?: { name?: string | null; value?: string | null }[] | null;
}): KeykeeperCategory {
  const template = templateOf(item);
  const fromTemplate = template ? TEMPLATE_CATEGORIES[template.id] : undefined;
  return fromTemplate ?? categoryOfType(item.type);
}

/**
 * The letter a tile shows for an item without a site icon: the first letter
 * or digit of its name, upper case, or nothing when the name has none.
 */
export function tileLetter(name: string | null | undefined): string {
  for (const char of name ?? "") {
    if (/[\p{L}\p{N}]/u.test(char)) {
      return char.toLocaleUpperCase();
    }
  }
  return "";
}

/**
 * The icon the server sends when a site has no icon of its own: Vaultwarden's
 * fallback, a 19 by 19 pixel globe (src/static/images/fallback-icon.png in
 * the server). Tiles treat it as no icon and show the item's letter. Sites'
 * own icons come in the usual sizes (16, 32, 48 pixels and up).
 */
export function isServerFallbackIcon(width: number, height: number): boolean {
  return width === 19 && height === 19;
}
