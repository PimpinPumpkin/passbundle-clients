import { CipherType, FieldType } from "../enums";
import { FieldView } from "../models/view/field.view";

import {
  categoryOfItem,
  categoryOfType,
  isServerFallbackIcon,
  KEYKEEPER_CATEGORY_LOOKS,
  KEYKEEPER_TILE_TINT,
  tileLetter,
  tileTint,
} from "./categories";
import { flatTileFailures } from "./flat-tile-contrast.spec-util";
import { BUILT_IN_TEMPLATES, templateFields } from "./templates";

describe("categories", () => {
  it("gives every kind of item its category", () => {
    expect(categoryOfType(CipherType.Login)).toBe("login");
    expect(categoryOfType(CipherType.SecureNote)).toBe("note");
    expect(categoryOfType(CipherType.Card)).toBe("card");
    expect(categoryOfType(CipherType.Identity)).toBe("identity");
    expect(categoryOfType(CipherType.SshKey)).toBe("sshKey");
    expect(categoryOfType(CipherType.BankAccount)).toBe("bank");
    expect(categoryOfType(null)).toBe("all");
  });

  it("shows an item made from a template with its own color as that template's", () => {
    const wifi = BUILT_IN_TEMPLATES.find((t) => t.id === "wifi")!;
    const server = BUILT_IN_TEMPLATES.find((t) => t.id === "server")!;
    const license = BUILT_IN_TEMPLATES.find((t) => t.id === "software-license")!;

    expect(categoryOfItem({ type: CipherType.SecureNote, fields: templateFields(wifi) })).toBe(
      "wifi",
    );
    expect(categoryOfItem({ type: CipherType.Login, fields: templateFields(server) })).toBe(
      "server",
    );
    expect(categoryOfItem({ type: CipherType.SecureNote, fields: templateFields(license) })).toBe(
      "license",
    );
  });

  it("shows any other item as its kind, custom fields or not", () => {
    const field = new FieldView();
    field.name = "Network name";
    field.value = "Office";
    field.type = FieldType.Text;

    expect(categoryOfItem({ type: CipherType.SecureNote, fields: [field] })).toBe("note");
    expect(categoryOfItem({ type: CipherType.Card })).toBe("card");
  });

  it("keeps every tile's glyph readable on its tint, on every surface, light and dark (3:1 or more)", () => {
    expect(flatTileFailures(KEYKEEPER_CATEGORY_LOOKS)).toEqual([]);
    // The check catches a tone too light for its tint: the star's own gold.
    const gold = flatTileFailures({ gold: { light: "#B98310", dark: "#ECC25E", glyph: "" } });
    expect(gold).toContain("gold (light) on the ground: 2.65");
    expect(gold.every((failure) => failure.startsWith("gold (light) on "))).toBe(true);
  });

  it("tints a tile with its tone: 11% in light mode, 14% of the lighter tone in dark mode", () => {
    expect(KEYKEEPER_TILE_TINT).toEqual({ light: 0.11, dark: 0.14 });
    expect(tileTint(KEYKEEPER_CATEGORY_LOOKS.login, "light")).toBe("rgb(36 72 184 / 0.11)");
    expect(tileTint(KEYKEEPER_CATEGORY_LOOKS.login, "dark")).toBe("rgb(147 173 255 / 0.14)");
  });

  it("puts a name's first letter or digit on a tile, in upper case", () => {
    expect(tileLetter("contoso Mail")).toBe("C");
    expect(tileLetter("  (work) GitHub")).toBe("W");
    expect(tileLetter("1Password import")).toBe("1");
    expect(tileLetter("élan")).toBe("É");
    expect(tileLetter(" -- ")).toBe("");
    expect(tileLetter(null)).toBe("");
  });

  it("knows the server's stand-in icon for a site without one", () => {
    expect(isServerFallbackIcon(19, 19)).toBe(true);
    expect(isServerFallbackIcon(16, 16)).toBe(false);
    expect(isServerFallbackIcon(32, 32)).toBe(false);
  });
});
