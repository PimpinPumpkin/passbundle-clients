// Keykeeper: every kind of item has a color and a glyph, the same wherever it
// shows (DESIGN.md, "The look", in the keykeeper repo). The colors are jewel
// tones, drawn as a flat tile: a soft tint of the tone with the glyph in the
// tone itself, and in dark mode a lighter tone for both, as on passbundle.com.
// The glyph keeps 3:1 or more on its tile, light and dark. Only the logo's
// tile is glossy. The extension's popup and the fill menu it draws inside
// websites both read them from here.
//
// Templates bring their own color where one fits (Wi-Fi, servers, licenses);
// the rest show the kind of item they're based on.

import { CipherType } from "../enums/cipher-type";

import { KEYKEEPER_GLYPHS } from "./glyphs";
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
  | "certificate"
  // Not kinds of items: the web vault's menu entries for them (DESIGN.md, "The left menu").
  | "favorites"
  | "health";

export type KeykeeperCategoryLook = {
  /** The tone on light backgrounds: the glyph's color, and the tile's tint. */
  light: string;
  /** On dark backgrounds, a lighter, softer tone for the glyph and the tint. */
  dark: string;
  /** The glyph: SVG path data on a 24 by 24 grid, stroked in the tone. */
  glyph: string;
};

/**
 * How much of its tone tints a tile, over whatever the tile sits on: 11% in
 * light mode, 14% of the lighter tone in dark mode (passbundle.com's too).
 */
export const KEYKEEPER_TILE_TINT = { light: 0.11, dark: 0.14 } as const;

/** A tile's background in a theme: its tone at the theme's tint, as a CSS color. */
export function tileTint(look: KeykeeperCategoryLook, theme: "light" | "dark"): string {
  const tone = look[theme];
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(tone.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${KEYKEEPER_TILE_TINT[theme]})`;
}

const glyphs = KEYKEEPER_GLYPHS;

export const KEYKEEPER_CATEGORY_LOOKS: Readonly<Record<KeykeeperCategory, KeykeeperCategoryLook>> =
  {
    // Emerald, the logo's color: "everything".
    all: { light: "#0E7A5A", dark: "#5FD6AE", glyph: glyphs.grid },
    // Sapphire.
    login: { light: "#2448B8", dark: "#93ADFF", glyph: glyphs.key },
    // Topaz.
    note: { light: "#A9600C", dark: "#F2B766", glyph: glyphs.note },
    // Amethyst.
    card: { light: "#6B30B8", dark: "#C6A3FF", glyph: glyphs.card },
    // Turquoise.
    identity: { light: "#08788A", dark: "#62D3E3", glyph: glyphs.identity },
    // Onyx.
    sshKey: { light: "#353B4A", dark: "#C3C9D6", glyph: glyphs.terminal },
    // Emerald, a bank's.
    bank: { light: "#0E7A47", dark: "#6FDBA0", glyph: glyphs.bank },
    // Aquamarine.
    wifi: { light: "#1C7FB8", dark: "#7CC4EF", glyph: glyphs.wifi },
    // Garnet.
    server: { light: "#A8291F", dark: "#FF9D92", glyph: glyphs.server },
    // Ruby.
    license: { light: "#B01E54", dark: "#FF92B8", glyph: glyphs.license },
    apiKey: { light: "#353B4A", dark: "#C3C9D6", glyph: glyphs.key },
    domain: { light: "#1C7FB8", dark: "#7CC4EF", glyph: glyphs.globe },
    email: { light: "#2448B8", dark: "#93ADFF", glyph: glyphs.envelope },
    certificate: { light: "#B01E54", dark: "#FF92B8", glyph: glyphs.badge },
    // The menu's Favorites, in gold, and Health, in a bank's emerald. Gold is
    // a shade deeper than the star's, so its glyph keeps 3:1 on its tint.
    favorites: { light: "#946A0C", dark: "#ECC25E", glyph: glyphs.star },
    health: { light: "#0E7A47", dark: "#6FDBA0", glyph: glyphs.shield },
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
