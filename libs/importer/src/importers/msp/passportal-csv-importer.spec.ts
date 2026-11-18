import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";

import { ImportResult } from "../../models/import-result";

import { PassportalCsvImporter } from "./passportal-csv-importer";

// Made up by hand, one oddity at a time: the columns of Passportal's password
// import template, which its export writes back (msp-formats.ts). No real
// clients, people, or passwords.
const HEADER =
  "Passportal ID,Client Name,Credential Type,Username,Password,Description,Expires (Yes/No),Notes,URL,Folder,TOTP Secret";

const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n");

const folderOf = (result: ImportResult, index: number) => {
  const relationship = result.folderRelationships.find(([cipher]) => cipher === index);
  return relationship == null ? null : result.folders[relationship[1]].name;
};

const field = (result: ImportResult, index: number, name: string) =>
  result.ciphers[index].fields.find((f) => f.name === name);

describe("Passportal CSV importer", () => {
  let importer: PassportalCsvImporter;

  beforeEach(() => {
    importer = new PassportalCsvImporter();
  });

  it("reads a row's name, username, password, website, notes, and one-time code secret", async () => {
    const result = await importer.parse(
      csv(
        "1001,Test Dental Group,Website,front.desk,Fake-Pass-1,Practice portal,Yes,Ask the office manager,portal.example.test,Admin,JBSW Y3DP EHPK 3PXP",
      ),
    );

    expect(result.success).toBe(true);
    expect(result.ciphers).toHaveLength(1);
    const cipher = result.ciphers[0];
    expect(cipher.type).toBe(CipherType.Login);
    expect(cipher.name).toBe("Practice portal");
    expect(cipher.login.username).toBe("front.desk");
    expect(cipher.login.password).toBe("Fake-Pass-1");
    expect(cipher.login.uris.map((u) => u.uri)).toEqual(["http://portal.example.test"]);
    expect(cipher.login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(cipher.notes).toBe("Ask the office manager");
  });

  it("keeps the other columns as fields: plain ones as text, the rest hidden", async () => {
    const result = await importer.parse(
      csv("1001,Test Dental Group,Router,admin,Fake-Pass-2,Front office router,No,,,,"),
    );

    expect(result.ciphers[0].fields.map((f) => [f.name, f.value, f.type])).toEqual([
      ["Passportal ID", "1001", FieldType.Text],
      ["Credential Type", "Router", FieldType.Text],
      ["Expires (Yes/No)", "No", FieldType.Text],
    ]);
  });

  it("hides a column it doesn't know, since it could be a secret", async () => {
    const result = await importer.parse(
      [
        HEADER + ",Recovery Key,Disabled",
        "1002,Test Dental Group,Domain Administrator,TDG\\admin,Fake-Pass-3,Domain admin,Yes,,,Servers,,FAKE-RECOVERY-0000,No",
      ].join("\n"),
    );

    expect(field(result, 0, "Recovery Key")).toMatchObject({
      value: "FAKE-RECOVERY-0000",
      type: FieldType.Hidden,
    });
    expect(field(result, 0, "Disabled")).toMatchObject({ value: "No", type: FieldType.Hidden });
  });

  it("reads quoted commas, quotes, and line breaks inside a value", async () => {
    const result = await importer.parse(
      csv(
        '1003,"Example Plumbing, Inc.",Website,"dispatch@example.test","Fake,""Pass"",4","Billing, the old portal",No,"Line one\nLine two, with a comma",billing.example.test,Accounts,',
      ),
    );

    const cipher = result.ciphers[0];
    expect(cipher.name).toBe("Billing, the old portal");
    expect(cipher.login.password).toBe('Fake,"Pass",4');
    expect(cipher.notes).toBe("Line one\nLine two, with a comma");
    expect(folderOf(result, 0)).toBe("Example Plumbing, Inc./Accounts");
  });

  it("imports a row with an empty password", async () => {
    const result = await importer.parse(
      csv("1004,Test Dental Group,Website,reception,,Supplier catalog,No,,catalog.example.test,,"),
    );

    expect(result.ciphers).toHaveLength(1);
    expect(result.ciphers[0].type).toBe(CipherType.Login);
    expect(result.ciphers[0].login.username).toBe("reception");
    expect(result.ciphers[0].login.password).toBeNull();
  });

  it("makes each client a folder, with Passportal's folders under it", async () => {
    const result = await importer.parse(
      csv(
        "1,Test Dental Group,Router,admin,Fake-Pass-5,Router,No,,,Network//Firewall,",
        "2,Test Dental Group,Website,office,Fake-Pass-6,Supplier,No,,,Network,",
        "3,Example Plumbing Co,Website,owner,Fake-Pass-7,Bank,No,,,,",
      ),
    );

    expect(result.folders.map((f) => f.name).sort()).toEqual([
      "Example Plumbing Co",
      "Test Dental Group",
      "Test Dental Group/Network",
      "Test Dental Group/Network/Firewall",
    ]);
    expect(folderOf(result, 0)).toBe("Test Dental Group/Network/Firewall");
    expect(folderOf(result, 1)).toBe("Test Dental Group/Network");
    // A client with no folder: its rows are in the client's folder.
    expect(folderOf(result, 2)).toBe("Example Plumbing Co");
  });

  it("makes them shared folders when importing into an organization", async () => {
    importer.organizationId = "00000000-0000-4000-8000-000000000001" as OrganizationId;
    const result = await importer.parse(
      csv(
        "1,Test Dental Group,Router,admin,Fake-Pass-5,Router,No,,,Network,",
        "2,Example Plumbing Co,Website,owner,Fake-Pass-7,Bank,No,,,,",
      ),
    );

    expect(result.folders).toEqual([]);
    expect(result.collections.map((c) => c.name).sort()).toEqual([
      "Example Plumbing Co",
      "Test Dental Group",
      "Test Dental Group/Network",
    ]);
    const collectionOf = (index: number) => {
      const relationship = result.collectionRelationships.find(([cipher]) => cipher === index);
      return relationship == null ? null : result.collections[relationship[1]].name;
    };
    expect(collectionOf(0)).toBe("Test Dental Group/Network");
    expect(collectionOf(1)).toBe("Example Plumbing Co");
  });

  describe("a file with several clients", () => {
    const twoClients = csv(
      "1,Test Dental Group,Router,admin,Fake-Pass-5,Router,No,,,Network,",
      "2,Example Plumbing Co,Website,owner,Fake-Pass-7,Bank,No,,,,",
      "3,Test Dental Group,Website,office,Fake-Pass-6,Supplier,No,,,,",
      ",,,,,,,,,,",
      "4,,Website,someone,Fake-Pass-8,No client,No,,,,",
    );

    it("lists each client with how many rows it has, the rows with none last", () => {
      expect(importer.customers(twoClients)).toEqual([
        { name: "Example Plumbing Co", rows: 1 },
        { name: "Test Dental Group", rows: 2 },
        { name: "", rows: 1 },
      ]);
    });

    it("imports only the client chosen, and says how many it left out", async () => {
      importer.onlyCustomer = "Test Dental Group";
      const result = await importer.parse(twoClients);

      expect(result.ciphers.map((c) => c.name)).toEqual(["Router", "Supplier"]);
      expect(result.folders.map((f) => f.name).sort()).toEqual([
        "Test Dental Group",
        "Test Dental Group/Network",
      ]);
      expect(result.leftOut).toEqual([
        "Left out 1 empty row.",
        "Left out 2 passwords for other clients.",
      ]);
    });

    it("imports the rows with no client when those are chosen", async () => {
      importer.onlyCustomer = "";
      const result = await importer.parse(twoClients);

      expect(result.ciphers.map((c) => c.name)).toEqual(["No client"]);
      expect(result.folders).toEqual([]);
    });

    it("imports every client without a choice", async () => {
      const result = await importer.parse(twoClients);

      expect(result.ciphers).toHaveLength(4);
      expect(result.leftOut).toEqual(["Left out 1 empty row."]);
    });
  });

  it("reads My Vault's export, which has no client", async () => {
    const myVault = [
      "PassportalID (BLANK),Credential,Username,Password,Description,Expires (Yes/No),notes,URL,Folder (optional),TOTP Secret",
      ",Website,tech.one,Fake-Pass-9,My test login,No,,tools.example.test,Tools,",
    ].join("\n");
    const result = await importer.parse(myVault);

    expect(result.success).toBe(true);
    expect(result.ciphers[0].name).toBe("My test login");
    expect(result.ciphers[0].login.username).toBe("tech.one");
    expect(folderOf(result, 0)).toBe("Tools");
    expect(field(result, 0, "Credential")).toMatchObject({
      value: "Website",
      type: FieldType.Text,
    });
    expect(importer.customers(myVault)).toEqual([{ name: "", rows: 1 }]);
  });

  it("names a row by its website, then its credential type, when it has no description", async () => {
    const result = await importer.parse(
      csv(
        "1,Test Dental Group,Website,a,Fake-1,,No,,https://www.mail.example.test/login,,",
        "2,Test Dental Group,Wireless,,Fake-2,,No,,,,",
      ),
    );

    expect(result.ciphers.map((c) => c.name)).toEqual(["mail.example.test", "Wireless"]);
  });

  it("makes a row with nothing to sign in with a secure note", async () => {
    const result = await importer.parse(
      csv("1,Test Dental Group,Serial Number,,,Server license,No,Kept in the safe,,,"),
    );

    expect(result.ciphers[0].type).toBe(CipherType.SecureNote);
    expect(result.ciphers[0].notes).toBe("Kept in the safe");
  });

  it("imports nothing from a file with only its header, and says so", async () => {
    const result = await importer.parse(HEADER);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This file has Passportal's columns but no passwords in its rows, so nothing was imported.",
    );
  });

  it("imports nothing from a file whose rows are empty, and says so", async () => {
    const result = await importer.parse(csv(",,,,,,,,,,", ""));

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("nothing was imported");
  });

  it("imports nothing from an empty file, and says so", async () => {
    const result = await importer.parse("  \n");

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("The file is empty, so nothing was imported.");
  });

  it("says a file isn't Passportal's, and which columns it lacks", async () => {
    const result = await importer.parse(
      "name,url,username,password,note\nMail,https://mail.example.test,a,Fake-1,",
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This isn't a Passportal export: it has no Client Name, Credential Type, or Description columns. If it came from Passportal, export it again with Include headers checked.",
    );
  });

  it("says when a file without headers isn't one it can read", async () => {
    const result = await importer.parse(
      "1001,Test Dental Group,Website,front.desk,Fake-Pass-1,Practice portal,Yes,,,,",
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("This isn't a Passportal export");
    expect(result.errorMessage).toContain("export it again with Include headers checked");
  });

  it("says when a file is IT Glue's instead", async () => {
    const result = await importer.parse(
      "id,organization,name,username,password,url,notes,password_category,otp_secret\n" +
        "1,Test Dental Group,Portal,a,Fake-1,,,Website,",
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This isn't a Passportal export: it has no Client Name, Credential Type, or Description columns. It looks like an IT Glue export: choose IT Glue (csv) instead.",
    );
    expect(importer.customers("id,organization,name,password\n1,A,B,C")).toBeNull();
  });

  it("reads columns however they're written, and a file saved with a byte order mark", async () => {
    const result = await importer.parse(
      "﻿client_name,credential_type,USERNAME,password,description,url\n" +
        "Test Dental Group,Website,a,Fake-1,Portal,portal.example.test",
    );

    expect(result.success).toBe(true);
    expect(result.ciphers[0].name).toBe("Portal");
    expect(folderOf(result, 0)).toBe("Test Dental Group");
  });
});
