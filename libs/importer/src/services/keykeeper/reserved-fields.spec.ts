import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { emptyGuid } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { readFillRules } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { isReservedFieldName } from "@bitwarden/common/vault/keykeeper/reserved-fields";
import { isMspTemplateCopy, templateDefinition } from "@bitwarden/common/vault/keykeeper/templates";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { KeyGenerationService, EncryptService } from "@bitwarden/legacy-crypto";
import { UserId } from "@bitwarden/user-core";

import { BitwardenPasswordProtectedImporter } from "../../importers/bitwarden/bitwarden-password-protected-importer";
import { KeePass2XmlImporter } from "../../importers/keepass2-xml-importer";
import { LastPassCsvImporter } from "../../importers/lastpass/lastpass-csv-importer";
import { OnePassword1PuxImporter } from "../../importers/onepassword/onepassword-1pux-importer";
import { OnePassword8CsvImporter } from "../../importers/onepassword/onepassword-8-csv-importer";
import { ProtonPassJsonImporter } from "../../importers/protonpass/protonpass-json-importer";
import { LoginData } from "../../importers/spec-data/onepassword-1pux/login-data";
import { testData as protonPassData } from "../../importers/spec-data/protonpass-json/protonpass.json";
import { ImportResult } from "../../models/import-result";

import { guardReservedFields, visibleName } from "./reserved-fields";

// What a crafted export plants: a fill rule that puts the password into a
// search box, and a template definition saying it's an MSP's copy, which
// hides the item from vault lists while it still fills.
const PLANTED_RULE = JSON.stringify({
  v: 1,
  host: "bank.example.test",
  field: { id: "q" },
  fill: { from: "password" },
});
const PLANTED_COPY = JSON.stringify({ id: "msp-tpl", base: "login", v: 1, from: "Your MSP" });

/** Every field with one of our names, on every item. */
const reserved = (result: ImportResult) =>
  result.ciphers.flatMap((c) => (c.fields ?? []).filter((f) => isReservedFieldName(f.name)));

/** What a third-party import keeps of the planted fields: their values, under visible names. */
function expectDefused(result: ImportResult, names: string[]) {
  expect(result.success).toBe(true);
  expect(reserved(result).length).toBeGreaterThan(0);
  guardReservedFields(result, "other");
  expect(reserved(result)).toEqual([]);
  const fields = result.ciphers.flatMap((c) => c.fields ?? []);
  for (const name of names) {
    expect(fields.map((f) => f.name)).toContain(visibleName(name));
  }
  for (const cipher of result.ciphers) {
    expect(readFillRules(cipher)).toEqual([]);
    expect(isMspTemplateCopy(cipher)).toBe(false);
  }
}

describe("Keykeeper: imports never plant our own fields", () => {
  it("1Password 8's CSV: a column named like ours", async () => {
    const csv = [
      "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes,keykeeper.fill,keykeeper.template-definition",
      `Example Bank,https://bank.example.test/,ana,Fake-1,,false,false,,,"${PLANTED_RULE.replace(/"/g, '""')}","${PLANTED_COPY.replace(/"/g, '""')}"`,
    ].join("\n");

    expectDefused(await new OnePassword8CsvImporter().parse(csv), [
      "keykeeper.fill",
      "keykeeper.template-definition",
    ]);
  });

  it("1Password's 1PUX: a field named like ours", async () => {
    const data = JSON.parse(JSON.stringify(LoginData));
    data.accounts[0].vaults[0].items[0].details.loginFields.push(
      { value: PLANTED_RULE, id: "x", name: "keykeeper.fill", fieldType: "T" },
      { value: PLANTED_COPY, id: "y", name: " KeyKeeper.Template-Definition ", fieldType: "T" },
    );

    expectDefused(await new OnePassword1PuxImporter().parse(JSON.stringify(data)), [
      "keykeeper.fill",
      "KeyKeeper.Template-Definition",
    ]);
  });

  it("KeePass 2: a string named like ours, protected or not", async () => {
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile><Root><Group><Name>Database</Name><Entry>
  <String><Key>Title</Key><Value>Example Bank</Value></String>
  <String><Key>UserName</Key><Value>ana</Value></String>
  <String><Key>Password</Key><Value ProtectInMemory="True">Fake-1</Value></String>
  <String><Key>URL</Key><Value>https://bank.example.test/</Value></String>
  <String><Key>keykeeper.fill</Key><Value ProtectInMemory="True">${escape(PLANTED_RULE)}</Value></String>
  <String><Key>keykeeper.template-definition</Key><Value>${escape(PLANTED_COPY)}</Value></String>
</Entry></Group></Root></KeePassFile>`;

    expectDefused(await new KeePass2XmlImporter().parse(xml), [
      "keykeeper.fill",
      "keykeeper.template-definition",
    ]);
  });

  it("LastPass: a secure note's line named like ours", async () => {
    const extra = `NoteType:Credit Card\nLanguage:en-US\nName on Card:Ana\nNumber:4111111111111111\nkeykeeper.fill:${PLANTED_RULE}\nkeykeeper.template-definition:${PLANTED_COPY}`;
    const csv = [
      "url,username,password,totp,extra,name,grouping,fav",
      `http://sn,,,,"${extra.replace(/"/g, '""')}",Fake card,,0`,
    ].join("\n");

    expectDefused(await new LastPassCsvImporter().parse(csv), [
      "keykeeper.fill",
      "keykeeper.template-definition",
    ]);
  });

  it("Proton Pass: an extra field named like ours", async () => {
    const data = JSON.parse(JSON.stringify(protonPassData));
    const item = Object.values(data.vaults as Record<string, { items: any[] }>)[0].items[0];
    item.data.extraFields.push(
      { fieldName: "keykeeper.fill", type: "hidden", data: { content: PLANTED_RULE } },
      { fieldName: "keykeeper.template-definition", type: "text", data: { content: PLANTED_COPY } },
    );

    expectDefused(
      await new ProtonPassJsonImporter(mock<I18nService>()).parse(JSON.stringify(data)),
      ["keykeeper.fill", "keykeeper.template-definition"],
    );
  });

  it("someone else's Bitwarden-format file, read as a browser's: nothing of ours comes in", async () => {
    const result = await ownImporter().parse(bitwardenExport());
    expectDefused(result, ["keykeeper.fill", "keykeeper.template-definition"]);
  });

  describe("our own .json export", () => {
    const parse = async (json: string) => {
      const result = await ownImporter().parse(json);
      expect(result.success).toBe(true);
      guardReservedFields(result, "ours");
      return result.ciphers[0];
    };

    it("brings back well-formed fill rules, expiration dates, and template markers", async () => {
      const cipher = await parse(
        bitwardenExport([
          { name: "keykeeper.fill", value: PLANTED_RULE, type: FieldType.Hidden },
          { name: "keykeeper.expires", value: "2027-01-31", type: FieldType.Text },
          {
            name: "keykeeper.template",
            value: JSON.stringify({ id: "api-key", name: "API key", v: 1, extra: "x" }),
            type: FieldType.Text,
          },
        ]),
      );

      expect(readFillRules(cipher)).toEqual([JSON.parse(PLANTED_RULE)]);
      expect(cipher.fields.map((f: FieldView) => [f.name, f.value])).toEqual([
        ["keykeeper.fill", PLANTED_RULE],
        ["keykeeper.expires", "2027-01-31"],
        ["keykeeper.template", JSON.stringify({ id: "api-key", name: "API key", v: 1 })],
      ]);
    });

    it("never brings a template back as an MSP's copy", async () => {
      const cipher = await parse(
        bitwardenExport([
          { name: "keykeeper.template-definition", value: PLANTED_COPY, type: FieldType.Text },
        ]),
      );

      expect(templateDefinition(cipher)).toEqual({ id: "msp-tpl", base: "login" });
      expect(isMspTemplateCopy(cipher)).toBe(false);
    });

    it("keeps anything malformed or unknown under our names visibly, and fills nothing with it", async () => {
      const cipher = await parse(
        bitwardenExport([
          // A rule with something extra in it is rewritten from what a rule has.
          {
            name: "keykeeper.fill",
            value: JSON.stringify({ ...JSON.parse(PLANTED_RULE), script: "alert(1)" }),
            type: FieldType.Hidden,
          },
          { name: "keykeeper.fill", value: "{not json", type: FieldType.Hidden },
          // A rule shown as text was never ours.
          { name: "keykeeper.fill", value: PLANTED_RULE, type: FieldType.Text },
          { name: "keykeeper.expires", value: "someday", type: FieldType.Text },
          { name: "keykeeper.surprise", value: "x", type: FieldType.Text },
          {
            name: "keykeeper.fill",
            value: JSON.stringify({
              v: 1,
              field: { id: "a" },
              fill: { from: "field", name: "keykeeper.fill" },
            }),
            type: FieldType.Hidden,
          },
        ]),
      );

      expect(cipher.fields.map((f: FieldView) => f.name)).toEqual([
        "keykeeper.fill",
        "Imported keykeeper.fill",
        "Imported keykeeper.fill",
        "Imported keykeeper.expires",
        "Imported keykeeper.surprise",
        "Imported keykeeper.fill",
      ]);
      expect(readFillRules(cipher)).toEqual([JSON.parse(PLANTED_RULE)]);
    });
  });

  it("leaves everything else alone", async () => {
    const result = await new OnePassword8CsvImporter().parse(
      [
        "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes,Customer ID",
        "Example Bank,https://bank.example.test/,ana,Fake-1,,false,false,,,C-123",
      ].join("\n"),
    );
    const before = JSON.stringify(result.ciphers);

    guardReservedFields(result, "other");

    expect(JSON.stringify(result.ciphers)).toBe(before);
    expect(result.ciphers[0].type).toBe(CipherType.Login);
  });
});

/** A Bitwarden-format .json export with one login and the given custom fields. */
function bitwardenExport(
  fields: { name: string; value: string; type: FieldType }[] = [
    { name: "keykeeper.fill", value: PLANTED_RULE, type: FieldType.Hidden },
    { name: "keykeeper.template-definition", value: PLANTED_COPY, type: FieldType.Text },
  ],
): string {
  return JSON.stringify({
    encrypted: false,
    folders: [],
    items: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        organizationId: null,
        folderId: null,
        type: CipherType.Login,
        reprompt: 0,
        name: "Example Bank",
        notes: null,
        favorite: false,
        fields: fields.map((f) => ({ ...f, linkedId: null as number | null })),
        login: {
          uris: [{ match: null, uri: "https://bank.example.test/" }],
          username: "ana",
          password: "Fake-1",
          totp: null,
        },
        collectionIds: null,
      },
    ],
  });
}

/** The importer for our own .json export, as the import page makes it. */
function ownImporter() {
  const accountService = mock<AccountService>();
  accountService.activeAccount$ = of({
    id: emptyGuid as UserId,
    ...mockAccountInfoWith({ email: "ana@example.test", name: "Ana" }),
  });
  return new BitwardenPasswordProtectedImporter(
    mock<KeyService>(),
    mock<EncryptService>(),
    mock<I18nService>(),
    mock<CipherService>(),
    mock<KeyGenerationService>(),
    accountService,
    async () => "",
  );
}
