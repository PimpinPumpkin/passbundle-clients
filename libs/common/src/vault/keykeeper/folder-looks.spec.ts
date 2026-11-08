import { mock } from "jest-mock-extended";

// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import { KEYKEEPER_CATEGORY_LOOKS } from "./categories";
import { flatTileFailures } from "./flat-tile-contrast.spec-util";
import {
  decryptFolderLook,
  encryptFolderLook,
  FOLDER_GLYPH,
  FOLDER_ICONS,
  FOLDER_TONES,
  folderLookText,
  folderTileLook,
  parseFolderLook,
  sameFolderLook,
} from "./folder-looks";

describe("folder looks", () => {
  it("offers our own glyphs and the tiles' tones, each once, named in plain words", () => {
    const icons = FOLDER_ICONS.map((i) => i.id);
    const tones = FOLDER_TONES.map((t) => t.id);
    expect(new Set(icons).size).toBe(icons.length);
    expect(new Set(tones).size).toBe(tones.length);
    expect(icons[0]).toBe("folder");
    expect(FOLDER_ICONS[0].glyph).toBe(FOLDER_GLYPH);
    // The categories' own glyphs, the same paths.
    expect(FOLDER_ICONS.find((i) => i.id === "bank")?.glyph).toBe(
      KEYKEEPER_CATEGORY_LOOKS.bank.glyph,
    );
    expect(FOLDER_ICONS.find((i) => i.id === "server")?.glyph).toBe(
      KEYKEEPER_CATEGORY_LOOKS.server.glyph,
    );
    for (const choice of [...FOLDER_ICONS, ...FOLDER_TONES]) {
      expect(choice.label).toMatch(/^[A-Z][A-Za-z -]+$/);
      expect(choice.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    // The tones are the tiles' jewel tones, light and dark.
    expect(FOLDER_TONES.find((t) => t.id === "sapphire")).toMatchObject({
      label: "Blue",
      light: KEYKEEPER_CATEGORY_LOOKS.login.light,
      dark: KEYKEEPER_CATEGORY_LOOKS.login.dark,
    });
    expect(FOLDER_TONES.find((t) => t.id === "gold")).toMatchObject({
      light: KEYKEEPER_CATEGORY_LOOKS.favorites.light,
      dark: KEYKEEPER_CATEGORY_LOOKS.favorites.dark,
    });
  });

  it("keeps every color's glyph readable on its tint, on every surface, light and dark", () => {
    const looks = Object.fromEntries(
      FOLDER_TONES.map((t) => [t.id, { light: t.light, dark: t.dark, glyph: FOLDER_GLYPH }]),
    );
    expect(flatTileFailures(looks)).toEqual([]);
  });

  it("encrypts only the names, in one order, and reads them back", () => {
    expect(folderLookText({ tone: "emerald", icon: "bank" } as never)).toBe(
      '{"icon":"bank","tone":"emerald"}',
    );
    expect(parseFolderLook('{"icon":"bank","tone":"emerald"}')).toEqual({
      icon: "bank",
      tone: "emerald",
    });
    // A newer app's names are kept, so saving never drops them.
    expect(parseFolderLook('{"icon":"rocket","tone":"coral","more":1}')).toEqual({
      icon: "rocket",
      tone: "coral",
    });
  });

  it("is the plain folder for anything that isn't a look", () => {
    for (const text of [
      null,
      undefined,
      "",
      "bank",
      "[]",
      "null",
      '{"icon":"bank"}',
      '{"icon":7,"tone":"emerald"}',
      '{"icon":"Bank","tone":"emerald"}',
      '{"icon":"<img src=x>","tone":"emerald"}',
      `{"icon":"${"a".repeat(40)}","tone":"emerald"}`,
    ]) {
      expect(parseFolderLook(text)).toBeUndefined();
    }
  });

  it("draws a look as a tile, with the folder glyph or gray for what it doesn't know", () => {
    expect(folderTileLook(null)).toBeUndefined();
    expect(folderTileLook(undefined)).toBeUndefined();
    expect(folderTileLook({ icon: "bank", tone: "emerald" })).toEqual({
      light: "#0E7A47",
      dark: "#6FDBA0",
      glyph: KEYKEEPER_CATEGORY_LOOKS.bank.glyph,
    });
    expect(folderTileLook({ icon: "rocket", tone: "coral" })).toEqual({
      light: "#353B4A",
      dark: "#C3C9D6",
      glyph: FOLDER_GLYPH,
    });
  });

  it("compares looks by their names", () => {
    expect(sameFolderLook(null, undefined)).toBe(true);
    expect(
      sameFolderLook({ icon: "bank", tone: "emerald" }, { icon: "bank", tone: "emerald" }),
    ).toBe(true);
    expect(sameFolderLook({ icon: "bank", tone: "emerald" }, { icon: "bank", tone: "gold" })).toBe(
      false,
    );
    expect(sameFolderLook(null, { icon: "folder", tone: "gold" })).toBe(false);
  });

  describe("with the organization's key", () => {
    const key = new SymmetricCryptoKey(new Uint8Array(64));
    const encryptService = mock<EncryptService>();

    beforeEach(() => {
      encryptService.encryptString.mockReset();
      encryptService.decryptString.mockReset();
    });

    it("encrypts a look as the name is, and nothing for the plain folder", async () => {
      encryptService.encryptString.mockResolvedValue(new EncString("2.aXY=|Y3Q=|bWFj"));

      expect(await encryptFolderLook({ icon: "bank", tone: "emerald" }, key, encryptService)).toBe(
        "2.aXY=|Y3Q=|bWFj",
      );
      expect(encryptService.encryptString).toHaveBeenCalledWith(
        '{"icon":"bank","tone":"emerald"}',
        key,
      );
      expect(await encryptFolderLook(null, key, encryptService)).toBeNull();
      expect(encryptService.encryptString).toHaveBeenCalledTimes(1);
    });

    it("opens a look, and shows the plain folder for one that won't open", async () => {
      encryptService.decryptString.mockResolvedValueOnce('{"icon":"server","tone":"garnet"}');
      expect(await decryptFolderLook("2.aXY=|Y3Q=|bWFj", key, encryptService)).toEqual({
        icon: "server",
        tone: "garnet",
      });

      encryptService.decryptString.mockRejectedValueOnce(new Error("wrong key"));
      expect(await decryptFolderLook("2.aXY=|Y3Q=|bWFj", key, encryptService)).toBeUndefined();

      expect(await decryptFolderLook(undefined, key, encryptService)).toBeUndefined();
      expect(
        await decryptFolderLook("2.aXY=|Y3Q=|bWFj", undefined, encryptService),
      ).toBeUndefined();
      expect(encryptService.decryptString).toHaveBeenCalledTimes(2);
    });
  });
});
