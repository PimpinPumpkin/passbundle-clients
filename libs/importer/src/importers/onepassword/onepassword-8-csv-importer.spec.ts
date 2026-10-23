import { Utils } from "@bitwarden/common/platform/misc/utils";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";

import { OnePassword8CsvImporter } from "./onepassword-8-csv-importer";

// Keykeeper: 1Password 8's CSV export, made up: example.com addresses and fake passwords.
const header = "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes";

describe("1Password 8 CSV Importer", () => {
  let importer: OnePassword8CsvImporter;
  beforeEach(() => {
    importer = new OnePassword8CsvImporter();
  });

  it("should import a login with its website, TOTP, favorite, and notes", async () => {
    const result = await importer.parse(
      [
        header,
        'Example Mail,https://mail.example.com/login,test.person@example.com,Fake-Mail-Pass-01,"otpauth://totp/Example%20Mail:test.person%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Mail",true,false,,Recovery codes are in the fake safe.',
      ].join("\n"),
    );

    expect(result.success).toBe(true);
    expect(result.ciphers.length).toBe(1);
    const cipher = result.ciphers[0];
    expect(cipher.type).toBe(CipherType.Login);
    expect(cipher.name).toBe("Example Mail");
    expect(cipher.login.uris.map((u) => u.uri)).toEqual(["https://mail.example.com/login"]);
    expect(cipher.login.username).toBe("test.person@example.com");
    expect(cipher.login.password).toBe("Fake-Mail-Pass-01");
    expect(cipher.login.totp).toBe(
      "otpauth://totp/Example%20Mail:test.person%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Mail",
    );
    expect(cipher.favorite).toBe(true);
    expect(cipher.archivedDate).toBeUndefined();
    expect(cipher.notes).toBe("Recovery codes are in the fake safe.");
    expect(cipher.fields).toEqual([]);
    expect(result.folders).toEqual([]);
  });

  it("should read doubled quotes as one quote, and keep commas, backslashes, and line breaks", async () => {
    const result = await importer.parse(
      [
        header,
        'Commas and quotes,https://csv.example.com/,test.person,"a,b""c""""d,",,false,false,,',
        'Backslashes,https://legacy.example.org/,DOMAIN\\tperson,back\\slash\\\\double,,false,false,,"Two\nlines, and a ""quote"""',
      ].join("\r\n"),
    );

    expect(result.ciphers.map((c) => c.login.password)).toEqual([
      'a,b"c""d,',
      "back\\slash\\\\double",
    ]);
    expect(result.ciphers[1].login.username).toBe("DOMAIN\\tperson");
    expect(result.ciphers[1].notes).toBe('Two\nlines, and a "quote"');
  });

  it("should archive an archived item", async () => {
    const result = await importer.parse(
      [header, "Old forum,https://forum.example.com/,test.person,Fake-Pass-02,,false,true,,"].join(
        "\n",
      ),
    );

    expect(result.ciphers[0].archivedDate).toBeInstanceOf(Date);
    expect(result.ciphers[0].isArchived).toBe(true);
  });

  it("should make the first tag the folder, with folders inside folders", async () => {
    const result = await importer.parse(
      [
        header,
        "Test NAS,https://10.0.0.5:5001/,nasadmin,Fake-Pass-03,,false,false,Work/Servers,",
        "Example Bank,https://bank.example.com/,test.person,Fake-Pass-04,,true,false,Finance,",
        "No folder,https://none.example.com/,test.person,Fake-Pass-05,,false,false,,",
      ].join("\n"),
    );

    expect(result.folders.map((f) => f.name)).toEqual(["Work/Servers", "Work", "Finance"]);
    expect(result.folderRelationships).toEqual([
      [0, 0],
      [1, 2],
    ]);
    expect(result.ciphers.map((c) => c.notes)).toEqual([null, null, null]);
  });

  it("should keep every tag in the notes when there's more than one", async () => {
    const result = await importer.parse(
      [
        header,
        'Example Shop,https://shop.example.net/,test.person,Fake-Pass-06,,false,false,"Shopping,Important",A note.',
      ].join("\n"),
    );

    expect(result.folders.map((f) => f.name)).toEqual(["Shopping"]);
    expect(result.ciphers[0].notes).toBe("A note.\nTags: Shopping, Important");
  });

  it("should keep a column it doesn't know as a field", async () => {
    const result = await importer.parse(
      [
        `${header},Recovery key,Hint`,
        "Example,https://example.com/,test.person,Fake-Pass-07,,false,false,,,fake-recovery-0000,blue",
      ].join("\n"),
    );

    expect(result.ciphers[0].fields.map((f) => [f.name, f.value, f.type])).toEqual([
      ["Recovery key", "fake-recovery-0000", FieldType.Hidden],
      ["Hint", "blue", FieldType.Text],
    ]);
  });

  it("should name an item with no title after its website, and skip empty rows", async () => {
    const result = await importer.parse(
      [
        header,
        ",https://www.untitled.example.com/login,test.person,Fake-Pass-08,,false,false,,",
        ",,,,,,,,",
      ].join("\n"),
    );

    expect(result.ciphers.length).toBe(1);
    expect(result.ciphers[0].name).toBe("untitled.example.com");
  });

  it("should make an item with only notes a secure note, and keep one with only a TOTP a login", async () => {
    const result = await importer.parse(
      [
        header,
        "Just a note,,,,,false,false,,Nothing to sign in with.",
        "Codes only,,,,JBSWY3DPEHPK3PXP,false,false,,",
      ].join("\n"),
    );

    expect(result.ciphers[0].type).toBe(CipherType.SecureNote);
    expect(result.ciphers[0].notes).toBe("Nothing to sign in with.");
    expect(result.ciphers[1].type).toBe(CipherType.Login);
    expect(result.ciphers[1].login.totp).toBe("JBSWY3DPEHPK3PXP");
  });

  it("should make tags collections, without favorites, for an organization", async () => {
    importer.organizationId = Utils.newGuid() as OrganizationId;
    const result = await importer.parse(
      [header, "Test NAS,https://10.0.0.5:5001/,nasadmin,Fake-Pass-03,,true,false,Work,"].join(
        "\n",
      ),
    );

    expect(result.folders).toEqual([]);
    expect(result.collections.map((c) => c.name)).toEqual(["Work"]);
    expect(result.collectionRelationships).toEqual([[0, 0]]);
    expect(result.ciphers[0].favorite).toBe(false);
  });
});
