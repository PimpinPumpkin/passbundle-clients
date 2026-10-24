import { CipherType, FieldType } from "../enums";
import { FieldView } from "../models/view/field.view";

import {
  categoryOfItem,
  categoryOfType,
  isServerFallbackIcon,
  KEYKEEPER_CATEGORY_LOOKS,
  tileLetter,
} from "./categories";
import { BUILT_IN_TEMPLATES, templateFields } from "./templates";

function lum(hex: string) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastWithWhite = (hex: string) => 1.05 / (lum(hex) + 0.05);

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

  it("keeps a white glyph readable on every tile, light and dark (3:1 or more)", () => {
    for (const look of Object.values(KEYKEEPER_CATEGORY_LOOKS)) {
      expect(contrastWithWhite(look.light)).toBeGreaterThanOrEqual(3);
      expect(contrastWithWhite(look.dark)).toBeGreaterThanOrEqual(3);
    }
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
