// Keykeeper: a shared folder's icon and color, like 1Password's vault icons
// (DESIGN.md, "Folder icons" in the keykeeper repo). Anyone who can rename a
// shared folder picks one of our flat glyphs and one of the tiles' tones; the
// folder then shows as a flat tile, the same as a category's (categories.ts),
// everywhere it shows. Until someone picks one, it keeps the plain folder
// glyph. No uploaded images.
//
// The choice says something about what's inside ("bank"), so it's encrypted
// with the organization's key, as the folder's name is, and the server keeps
// only the ciphertext. What's encrypted is a small JSON object of names,
// `{"icon":"bank","tone":"emerald"}`; the apps (passbundle-apps,
// app/lib/folder_looks.dart) know the same names. A name an app doesn't know
// (a newer icon, say) still shows: the folder glyph, or the gray tone.

import { EncryptService } from "../../key-management/crypto/abstractions/encrypt.service";
import { EncString } from "../../key-management/crypto/models/enc-string";
import { SymmetricCryptoKey } from "../../platform/models/domain/symmetric-crypto-key";

import type { KeykeeperCategoryLook } from "./categories";
import { KEYKEEPER_GLYPHS } from "./glyphs";

/** A folder's icon and color, by name. */
export type FolderLook = { icon: string; tone: string };

export type FolderIcon = {
  /** Stored, and the same in every app. */
  id: string;
  /** What it shows, in plain words, for the picker. */
  label: string;
  /** SVG path data on a 24 by 24 grid, stroked in the tone. */
  glyph: string;
};

export type FolderTone = {
  id: string;
  /** The color's everyday name, for the picker. */
  label: string;
  /** On light backgrounds: the glyph's color, and the tile's tint. */
  light: string;
  /** On dark backgrounds: a lighter, softer tone for both. */
  dark: string;
};

/**
 * The folder's own glyph: a plain folder (the apps' Glyphs.folder), for a
 * folder that's only given a color, and for an icon an app doesn't know.
 */
export const FOLDER_GLYPH = "M3 6h6l2 2h10v11H3Z";

/**
 * The icons to pick from, in the picker's order: the categories' glyphs and
 * passbundle.com's (site/icons.mjs in the keykeeper repo), the ones that say
 * what a folder holds.
 */
export const FOLDER_ICONS: readonly FolderIcon[] = [
  { id: "folder", label: "Folder", glyph: FOLDER_GLYPH },
  {
    id: "people",
    label: "People",
    glyph:
      "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M3 20c.8-3.4 3-5 6-5s5.2 1.6 6 5 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 15c1.6.7 2.6 2.4 3 5",
  },
  { id: "bank", label: "Bank", glyph: KEYKEEPER_GLYPHS.bank },
  {
    id: "coins",
    label: "Money",
    glyph:
      "M4 7c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3Z M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7 M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
  },
  { id: "card", label: "Card", glyph: KEYKEEPER_GLYPHS.card },
  { id: "key", label: "Key", glyph: KEYKEEPER_GLYPHS.key },
  {
    id: "lock",
    label: "Lock",
    glyph: "M6 11h12v10H6Z M8.5 11V8a3.5 3.5 0 0 1 7 0v3 M12 15v2",
  },
  { id: "shield", label: "Shield", glyph: KEYKEEPER_GLYPHS.shield },
  { id: "server", label: "Server", glyph: KEYKEEPER_GLYPHS.server },
  { id: "terminal", label: "Terminal", glyph: KEYKEEPER_GLYPHS.terminal },
  { id: "code", label: "Code", glyph: "M8 7l-5 5 5 5 M16 7l5 5-5 5 M13.5 5l-3 14" },
  { id: "globe", label: "Globe", glyph: KEYKEEPER_GLYPHS.globe },
  { id: "browser", label: "Browser", glyph: "M3 5h18v14H3Z M3 9h18 M6 7h.01 M9 7h.01" },
  { id: "envelope", label: "Email", glyph: KEYKEEPER_GLYPHS.envelope },
  { id: "chat", label: "Chat", glyph: "M4 5h16v11H9l-5 4Z M8 9.5h8 M8 12.5h5" },
  { id: "phone", label: "Phone", glyph: "M8 3h8v18H8Z M11 17.5h2" },
  {
    id: "laptop",
    label: "Laptop",
    glyph: "M5 5h14v10H5Z M2.5 19h19 M4 15l-1.5 4 M20 15l1.5 4",
  },
  { id: "desktop", label: "Computer", glyph: "M3 4h18v12H3Z M8 20h8 M12 16v4" },
  { id: "wifi", label: "Wi-Fi", glyph: KEYKEEPER_GLYPHS.wifi },
  { id: "identity", label: "ID card", glyph: KEYKEEPER_GLYPHS.identity },
  { id: "license", label: "License", glyph: KEYKEEPER_GLYPHS.license },
  { id: "note", label: "Document", glyph: KEYKEEPER_GLYPHS.note },
  { id: "star", label: "Star", glyph: KEYKEEPER_GLYPHS.star },
  {
    id: "lifebuoy",
    label: "Help",
    glyph:
      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M5.6 5.6l3.6 3.6 M14.8 14.8l3.6 3.6 M18.4 5.6l-3.6 3.6 M9.2 14.8l-3.6 3.6",
  },
];

/**
 * The colors to pick from: the tiles' jewel tones (DESIGN.md, "The look"),
 * named as people name colors. Each keeps its glyph at 3:1 on its tint.
 */
export const FOLDER_TONES: readonly FolderTone[] = [
  { id: "sapphire", label: "Blue", light: "#2448B8", dark: "#93ADFF" },
  { id: "aquamarine", label: "Sky blue", light: "#1C7FB8", dark: "#7CC4EF" },
  { id: "turquoise", label: "Teal", light: "#08788A", dark: "#62D3E3" },
  { id: "emerald", label: "Green", light: "#0E7A47", dark: "#6FDBA0" },
  { id: "gold", label: "Gold", light: "#946A0C", dark: "#ECC25E" },
  { id: "topaz", label: "Orange", light: "#A9600C", dark: "#F2B766" },
  { id: "garnet", label: "Red", light: "#A8291F", dark: "#FF9D92" },
  { id: "ruby", label: "Pink", light: "#B01E54", dark: "#FF92B8" },
  { id: "amethyst", label: "Purple", light: "#6B30B8", dark: "#C6A3FF" },
  { id: "onyx", label: "Gray", light: "#353B4A", dark: "#C3C9D6" },
];

/** A folder given an icon but no color yet gets this one. */
export const DEFAULT_FOLDER_TONE = "sapphire";
/** A tone an app doesn't know shows as this one. */
const FALLBACK_TONE = "onyx";

/** Names are short and plain: what the apps store and send, and nothing else. */
const NAME = /^[a-z][a-z0-9-]{0,31}$/;

export function folderIcon(id: string | undefined): FolderIcon | undefined {
  return FOLDER_ICONS.find((icon) => icon.id === id);
}

export function folderTone(id: string | undefined): FolderTone | undefined {
  return FOLDER_TONES.find((tone) => tone.id === id);
}

/** What's encrypted: the names alone, always in this order. */
export function folderLookText(look: FolderLook): string {
  return JSON.stringify({ icon: look.icon, tone: look.tone });
}

/**
 * A decrypted look, or undefined for anything that isn't one (the plain
 * folder). Names it doesn't know are kept, so saving a folder never drops a
 * newer app's icon.
 */
export function parseFolderLook(text: string | null | undefined): FolderLook | undefined {
  if (!text) {
    return undefined;
  }
  try {
    const value = JSON.parse(text);
    if (
      value == null ||
      typeof value !== "object" ||
      typeof value.icon !== "string" ||
      typeof value.tone !== "string" ||
      !NAME.test(value.icon) ||
      !NAME.test(value.tone)
    ) {
      return undefined;
    }
    return { icon: value.icon, tone: value.tone };
  } catch {
    return undefined;
  }
}

/**
 * The tile a folder with a look shows (for KeykeeperCategoryTileComponent's
 * `look`), or undefined for the plain folder, which keeps its glyph.
 */
export function folderTileLook(
  look: FolderLook | null | undefined,
): KeykeeperCategoryLook | undefined {
  if (look == null) {
    return undefined;
  }
  const tone = folderTone(look.tone) ?? folderTone(FALLBACK_TONE)!;
  return {
    light: tone.light,
    dark: tone.dark,
    glyph: folderIcon(look.icon)?.glyph ?? FOLDER_GLYPH,
  };
}

export function sameFolderLook(
  a: FolderLook | null | undefined,
  b: FolderLook | null | undefined,
): boolean {
  return (a ?? null) === (b ?? null) || (a?.icon === b?.icon && a?.tone === b?.tone);
}

/**
 * Opens a folder's look with its organization's key. Anything that doesn't
 * open, or isn't a look once open, is the plain folder: a folder's icon is
 * never worth an error.
 */
export async function decryptFolderLook(
  encrypted: string | null | undefined,
  key: SymmetricCryptoKey | null | undefined,
  encryptService: EncryptService,
): Promise<FolderLook | undefined> {
  if (!encrypted || key == null) {
    return undefined;
  }
  try {
    return parseFolderLook(await encryptService.decryptString(new EncString(encrypted), key));
  } catch {
    return undefined;
  }
}

/** A look encrypted with its organization's key, as the server keeps it; null for the plain folder. */
export async function encryptFolderLook(
  look: FolderLook | null | undefined,
  key: SymmetricCryptoKey,
  encryptService: EncryptService,
): Promise<string | null> {
  if (look == null) {
    return null;
  }
  const encrypted = await encryptService.encryptString(folderLookText(look), key);
  return encrypted.encryptedString ?? null;
}
