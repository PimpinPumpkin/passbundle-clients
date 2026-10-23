import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { KeePass2XmlImporter } from "./keepass2-xml-importer";
import {
  TestData,
  TestData1,
  TestData2,
  TestDataWithProtectedFields,
} from "./spec-data/keepass2-xml/keepass2-xml-importer-testdata";

describe("KeePass2 Xml Importer", () => {
  it("should parse XML data", async () => {
    const importer = new KeePass2XmlImporter();
    const result = await importer.parse(TestData);
    expect(result != null).toBe(true);
  });

  it("parse XML should contains folders", async () => {
    const importer = new KeePass2XmlImporter();
    const folder = new FolderView();
    folder.name = "Folder2";
    const actual = [folder];

    const result = await importer.parse(TestData);
    expect(result.folders[0].name).toEqual(actual[0].name);
  });

  it("parse XML should contains login details", async () => {
    const importer = new KeePass2XmlImporter();
    const result = await importer.parse(TestData);
    expect(result.ciphers[0].login.uri != null).toBe(true);
    expect(result.ciphers[0].login.username != null).toBe(true);
    expect(result.ciphers[0].login.password != null).toBe(true);
  });

  // Keykeeper: KeePass exports its Recycle Bin; what's in it was deleted.
  it("should leave out the Recycle Bin and what's in it", async () => {
    const importer = new KeePass2XmlImporter();
    const entry = (title: string) =>
      `<Entry><String><Key>Title</Key><Value>${title}</Value></String>` +
      `<String><Key>Password</Key><Value ProtectInMemory="True">not-a-real-password</Value></String></Entry>`;
    const result = await importer.parse(
      `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile>
  <Meta>
    <RecycleBinEnabled>True</RecycleBinEnabled>
    <RecycleBinUUID>cmVjeWNsZS1iaW4tMDAwMQ==</RecycleBinUUID>
  </Meta>
  <Root>
    <Group>
      <UUID>cm9vdC1ncm91cC0wMDAwMQ==</UUID>
      <Name>Database</Name>
      ${entry("At the top")}
      <Group>
        <UUID>d29yay1ncm91cC0wMDAwMQ==</UUID>
        <Name>Work</Name>
        ${entry("At work")}
      </Group>
      <Group>
        <UUID>cmVjeWNsZS1iaW4tMDAwMQ==</UUID>
        <Name>Recycle Bin</Name>
        ${entry("Deleted")}
      </Group>
    </Group>
  </Root>
</KeePassFile>`,
    );

    expect(result.success).toBe(true);
    expect(result.ciphers.map((c) => c.name)).toEqual(["At the top", "At work"]);
    expect(result.folders.map((f) => f.name)).toEqual(["Work"]);
  });

  // Keykeeper: one entry in a database, from its strings ([key, value, protected?]).
  const database = (strings: [string, string, boolean?][]) =>
    `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile>
  <Root>
    <Group>
      <Name>Database</Name>
      <Entry>
        ${strings
          .map(
            ([key, value, protect]) =>
              `<String><Key>${key}</Key><Value${protect ? ' ProtectInMemory="True"' : ""}>${value}</Value></String>`,
          )
          .join("\n        ")}
      </Entry>
    </Group>
  </Root>
</KeePassFile>`;
  const parseOne = async (strings: [string, string, boolean?][]) => {
    const result = await new KeePass2XmlImporter().parse(database(strings));
    expect(result.success).toBe(true);
    expect(result.ciphers.length).toBe(1);
    return result.ciphers[0];
  };
  const login: [string, string, boolean?][] = [
    ["Title", "Example Mail"],
    ["UserName", "test.person"],
    ["Password", "not-a-real-password", true],
    ["URL", "https://mail.example.com/"],
  ];

  describe("TOTP", () => {
    it("should make KeePass 2.47's base32 secret the TOTP, not a hidden field", async () => {
      const cipher = await parseOne([
        ...login,
        ["TimeOtp-Secret-Base32", "JBSW Y3DP EHPK 3PXP", true],
      ]);

      expect(cipher.login.totp).toBe("JBSWY3DPEHPK3PXP");
      expect(cipher.fields).toEqual([]);
    });

    it("should turn KeePass's text, hex, and base64 secrets into base32", async () => {
      // The same 10 bytes, "1234567890", kept three ways.
      for (const [key, value] of [
        ["TimeOtp-Secret", "1234567890"],
        ["TimeOtp-Secret-Hex", "31323334353637383930"],
        ["TimeOtp-Secret-Base64", "MTIzNDU2Nzg5MA=="],
      ]) {
        const cipher = await parseOne([...login, [key, value, true]]);
        expect(cipher.login.totp).toBe("GEZDGNBVGY3TQOJQ");
        expect(cipher.fields).toEqual([]);
      }
    });

    it("should make an otpauth:// URI when the period, length, or algorithm isn't the default", async () => {
      const cipher = await parseOne([
        ...login,
        ["TimeOtp-Algorithm", "HMAC-SHA-256"],
        ["TimeOtp-Length", "8"],
        ["TimeOtp-Period", "60"],
        ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP", true],
      ]);

      expect(cipher.login.totp).toBe(
        "otpauth://totp/Example%20Mail:test.person?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Mail&algorithm=SHA256&digits=8&period=60",
      );
      expect(cipher.fields).toEqual([]);
    });

    it("should keep the default settings as just the secret", async () => {
      const cipher = await parseOne([
        ...login,
        ["TimeOtp-Algorithm", "HMAC-SHA-1"],
        ["TimeOtp-Length", "6"],
        ["TimeOtp-Period", "30"],
        ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP", true],
      ]);

      expect(cipher.login.totp).toBe("JBSWY3DPEHPK3PXP");
      expect(cipher.fields).toEqual([]);
    });

    it("should read KeeOtp's otp field", async () => {
      const plain = await parseOne([
        ...login,
        ["otp", "key=JBSWY3DPEHPK3PXP&amp;step=30&amp;size=6", true],
      ]);
      expect(plain.login.totp).toBe("JBSWY3DPEHPK3PXP");
      expect(plain.fields).toEqual([]);

      const sha512 = await parseOne([
        ...login,
        [
          "otp",
          "key=JBSWY3DPEHPK3PXP&amp;step=45&amp;size=7&amp;type=Totp&amp;otpHashMode=Sha512",
          true,
        ],
      ]);
      expect(sha512.login.totp).toBe(
        "otpauth://totp/Example%20Mail:test.person?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Mail&algorithm=SHA512&digits=7&period=45",
      );
    });

    it("should keep KeePassXC's otpauth:// URI as it is", async () => {
      const uri =
        "otpauth://totp/Example:test.person?secret=JBSWY3DPEHPK3PXP&amp;period=30&amp;digits=6&amp;issuer=Example";
      const cipher = await parseOne([...login, ["otp", uri, true]]);

      expect(cipher.login.totp).toBe(uri.replace(/&amp;/g, "&"));
      expect(cipher.fields).toEqual([]);
    });

    it("should read TrayTOTP's seed and settings, Steam's too", async () => {
      const totp = await parseOne([
        ...login,
        ["TOTP Seed", "JBSWY3DPEHPK3PXP", true],
        ["TOTP Settings", "30;8"],
      ]);
      expect(totp.login.totp).toBe(
        "otpauth://totp/Example%20Mail:test.person?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Mail&algorithm=SHA1&digits=8&period=30",
      );
      expect(totp.fields).toEqual([]);

      const steam = await parseOne([
        ...login,
        ["TOTP Seed", "JBSWY3DPEHPK3PXP", true],
        ["TOTP Settings", "30;S"],
      ]);
      expect(steam.login.totp).toBe("steam://JBSWY3DPEHPK3PXP");
    });

    it("should keep the fields as they were when they can't be read as a TOTP", async () => {
      const cipher = await parseOne([
        ...login,
        ["TimeOtp-Algorithm", "HMAC-MD5"],
        ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP", true],
      ]);

      expect(cipher.login.totp).toBeUndefined();
      expect(cipher.fields.map((f) => [f.name, f.value, f.type])).toEqual([
        ["TimeOtp-Algorithm", "HMAC-MD5", FieldType.Text],
        ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP", FieldType.Hidden],
      ]);
    });

    it("should leave a counter-based HOTP as fields", async () => {
      const cipher = await parseOne([
        ...login,
        ["HmacOtp-Counter", "3"],
        ["HmacOtp-Secret-Base32", "JBSWY3DPEHPK3PXP", true],
      ]);

      expect(cipher.login.totp).toBeUndefined();
      expect(cipher.fields.map((f) => f.name)).toEqual([
        "HmacOtp-Counter",
        "HmacOtp-Secret-Base32",
      ]);
    });
  });

  it("should make KP2A_URL and URL fields more websites, after the main one", async () => {
    const cipher = await parseOne([
      ["KP2A_URL", "https://login.example.org/"],
      ["KP2A_URL_1", "androidapp://com.example.mail"],
      ["Title", "Example Mail"],
      ["URL", "https://mail.example.com/"],
      ["URL 2", "https://mail.example.net/"],
      ["URL_3", "mail.example.test"],
      ["UserName", "test.person"],
      ["URLs to avoid", "kept as a field"],
    ]);

    expect(cipher.login.uris.map((u) => u.uri)).toEqual([
      "https://mail.example.com/",
      "https://login.example.org/",
      "androidapp://com.example.mail",
      "https://mail.example.net/",
      "http://mail.example.test",
    ]);
    expect(cipher.fields.map((f) => f.name)).toEqual(["URLs to avoid"]);
  });

  it("should keep the notes as they were, with what didn't fit in a field after them", async () => {
    const cipher = await parseOne([
      ["Long field", "A value\non two lines"],
      ["Notes", "The entry's own notes."],
      ["Title", "Example"],
      ["UserName", "test.person"],
    ]);

    expect(cipher.notes).toBe("The entry's own notes.\nLong field: A value\non two lines\n");
  });

  it("should make an entry with nothing to sign in with a secure note", async () => {
    const note = await parseOne([
      ["Notes", "Network: Fake-Home-5G"],
      ["Password", "", true],
      ["Title", "Home Wi-Fi"],
      ["UserName", ""],
    ]);
    expect(note.type).toBe(CipherType.SecureNote);
    expect(note.login).toBeNull();
    expect(note.notes).toBe("Network: Fake-Home-5G");

    const card = await parseOne([
      ["CVV", "123", true],
      ["Card number", "4111111111111111", true],
      ["Title", "Test Visa"],
    ]);
    expect(card.type).toBe(CipherType.SecureNote);
    expect(card.fields.map((f) => [f.name, f.value])).toEqual([
      ["CVV", "123"],
      ["Card number", "4111111111111111"],
    ]);

    // A TOTP is something to sign in with.
    const totpOnly = await parseOne([
      ["Title", "Codes only"],
      ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP", true],
    ]);
    expect(totpOnly.type).toBe(CipherType.Login);
    expect(totpOnly.login.totp).toBe("JBSWY3DPEHPK3PXP");
  });

  it("should return error with missing root tag", async () => {
    const importer = new KeePass2XmlImporter();
    const result = await importer.parse(TestData1);
    expect(result.errorMessage).toBe("Missing `KeePassFile > Root` node.");
  });

  it("should return error with missing KeePassFile tag", async () => {
    const importer = new KeePass2XmlImporter();
    const result = await importer.parse(TestData2);
    expect(result.success).toBe(false);
  });

  describe("protected fields handling", () => {
    it("should import protected custom fields as hidden fields", async () => {
      const importer = new KeePass2XmlImporter();
      const result = await importer.parse(TestDataWithProtectedFields);

      expect(result.success).toBe(true);
      expect(result.ciphers.length).toBe(1);

      const cipher = result.ciphers[0];
      expect(cipher.name).toBe("Test Entry");
      expect(cipher.login.username).toBe("testuser");
      expect(cipher.login.password).toBe("testpass");
      expect(cipher.notes).toContain("Regular notes");

      // Check that protected custom field is imported as hidden field
      const protectedField = cipher.fields.find((f) => f.name === "SAFE UN-LOCKING instructions");
      expect(protectedField).toBeDefined();
      expect(protectedField?.value).toBe("Secret instructions here");
      expect(protectedField?.type).toBe(FieldType.Hidden);

      // Check that regular custom field is imported as text field
      const regularField = cipher.fields.find((f) => f.name === "CustomField");
      expect(regularField).toBeDefined();
      expect(regularField?.value).toBe("Custom value");
      expect(regularField?.type).toBe(FieldType.Text);
    });

    it("should import long protected fields as hidden fields (not appended to notes)", async () => {
      const importer = new KeePass2XmlImporter();
      const result = await importer.parse(TestDataWithProtectedFields);

      const cipher = result.ciphers[0];

      // Long protected field should be imported as hidden field
      const longField = cipher.fields.find((f) => f.name === "LongProtectedField");
      expect(longField).toBeDefined();
      expect(longField?.type).toBe(FieldType.Hidden);
      expect(longField?.value).toContain("This is a very long protected field");

      // Should not be appended to notes
      expect(cipher.notes).not.toContain("LongProtectedField");
    });

    it("should import multiline protected fields as hidden fields (not appended to notes)", async () => {
      const importer = new KeePass2XmlImporter();
      const result = await importer.parse(TestDataWithProtectedFields);

      const cipher = result.ciphers[0];

      // Multiline protected field should be imported as hidden field
      const multilineField = cipher.fields.find((f) => f.name === "MultilineProtectedField");
      expect(multilineField).toBeDefined();
      expect(multilineField?.type).toBe(FieldType.Hidden);
      expect(multilineField?.value).toContain("Line 1");

      // Should not be appended to notes
      expect(cipher.notes).not.toContain("MultilineProtectedField");
    });

    it("should not append protected custom fields to notes", async () => {
      const importer = new KeePass2XmlImporter();
      const result = await importer.parse(TestDataWithProtectedFields);

      const cipher = result.ciphers[0];
      expect(cipher.notes).not.toContain("SAFE UN-LOCKING instructions");
      expect(cipher.notes).not.toContain("Secret instructions here");
    });
  });
});
