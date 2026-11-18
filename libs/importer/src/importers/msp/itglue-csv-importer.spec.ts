import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";

import { ImportResult } from "../../models/import-result";

import { ITGlueCsvImporter } from "./itglue-csv-importer";

// Made up by hand, one oddity at a time: the columns of IT Glue's password
// importer, which its export's passwords.csv brings (msp-formats.ts), with
// the password folder column we guess at. No real organizations, people, or
// passwords.
const HEADER =
  "id,organization,name,username,password,url,notes,password_category,password_folder,otp_secret,resource_type,resource_id";

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

const folderOf = (result: ImportResult, index: number) => {
  const relationship = result.folderRelationships.find(([cipher]) => cipher === index);
  return relationship == null ? null : result.folders[relationship[1]].name;
};

const field = (result: ImportResult, index: number, name: string) =>
  result.ciphers[index].fields.find((f) => f.name === name);

describe("IT Glue CSV importer", () => {
  let importer: ITGlueCsvImporter;

  beforeEach(() => {
    importer = new ITGlueCsvImporter();
  });

  it("reads a row's name, username, password, website, notes, and one-time code secret", async () => {
    const result = await importer.parse(
      csv(
        "5001,Sample Law LLP,Microsoft 365 admin,admin@law.example.test,Fake-Pass-1,https://admin.example.test,Break glass only,Email,,JBSWY3DPEHPK3PXP,,",
      ),
    );

    expect(result.success).toBe(true);
    const cipher = result.ciphers[0];
    expect(cipher.type).toBe(CipherType.Login);
    expect(cipher.name).toBe("Microsoft 365 admin");
    expect(cipher.login.username).toBe("admin@law.example.test");
    expect(cipher.login.password).toBe("Fake-Pass-1");
    expect(cipher.login.uris.map((u) => u.uri)).toEqual(["https://admin.example.test"]);
    expect(cipher.login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(cipher.notes).toBe("Break glass only");
  });

  it("keeps the id, category, and what an embedded password belongs to as plain fields", async () => {
    const result = await importer.parse(
      csv("5002,Sample Law LLP,Firewall,admin,Fake-Pass-2,,,Network Device,,,Configuration,77001"),
    );

    expect(result.ciphers[0].fields.map((f) => [f.name, f.value, f.type])).toEqual([
      ["id", "5002", FieldType.Text],
      ["password_category", "Network Device", FieldType.Text],
      ["resource_type", "Configuration", FieldType.Text],
      ["resource_id", "77001", FieldType.Text],
    ]);
  });

  it("hides a column it doesn't know, since it could be a secret", async () => {
    const result = await importer.parse(
      [
        HEADER + ",autofill_selectors,recovery_phrase",
        "5003,Sample Law LLP,Payroll,clerk,Fake-Pass-3,,,,,,,,#login,fake words for a test",
      ].join("\n"),
    );

    expect(field(result, 0, "autofill_selectors")).toMatchObject({
      value: "#login",
      type: FieldType.Hidden,
    });
    expect(field(result, 0, "recovery_phrase")).toMatchObject({
      value: "fake words for a test",
      type: FieldType.Hidden,
    });
  });

  it("reads quoted commas, quotes, and line breaks inside a value", async () => {
    const result = await importer.parse(
      csv(
        '5004,"Example Clinic, PC","Door ""badge"" system",front,"Fake,Pass,4",,"First line\r\nSecond, line",Facilities,"Building, East",,,',
      ),
    );

    const cipher = result.ciphers[0];
    expect(cipher.name).toBe('Door "badge" system');
    expect(cipher.login.password).toBe("Fake,Pass,4");
    expect(cipher.notes).toBe("First line\nSecond, line");
    expect(folderOf(result, 0)).toBe("Example Clinic, PC/Building, East");
  });

  it("imports a row with an empty password", async () => {
    const result = await importer.parse(
      csv("5005,Sample Law LLP,Vendor portal,billing,,https://vendor.example.test,,,,,,"),
    );

    expect(result.ciphers[0].type).toBe(CipherType.Login);
    expect(result.ciphers[0].login.password).toBeNull();
  });

  it("makes each organization a folder, with its password folder under it", async () => {
    const result = await importer.parse(
      csv(
        "1,Sample Law LLP,Wi-Fi,,Fake-Pass-5,,,,Network,,,",
        "2,Example Clinic PC,EHR,doctor,Fake-Pass-6,,,,,,,",
      ),
    );

    expect(result.folders.map((f) => f.name).sort()).toEqual([
      "Example Clinic PC",
      "Sample Law LLP",
      "Sample Law LLP/Network",
    ]);
    expect(folderOf(result, 0)).toBe("Sample Law LLP/Network");
    // An organization with no folder: its rows are in the organization's folder.
    expect(folderOf(result, 1)).toBe("Example Clinic PC");
  });

  it("makes them shared folders when importing into an organization", async () => {
    importer.organizationId = "00000000-0000-4000-8000-000000000002" as OrganizationId;
    const result = await importer.parse(
      csv(
        "1,Sample Law LLP,Wi-Fi,,Fake-Pass-5,,,,Network,,,",
        "2,Example Clinic PC,EHR,doctor,Fake-Pass-6,,,,,,,",
      ),
    );

    expect(result.folders).toEqual([]);
    expect(result.collections.map((c) => c.name).sort()).toEqual([
      "Example Clinic PC",
      "Sample Law LLP",
      "Sample Law LLP/Network",
    ]);
  });

  describe("a file with several organizations", () => {
    const twoOrganizations = csv(
      "1,Sample Law LLP,Wi-Fi,,Fake-Pass-5,,,,Network,,,",
      "2,Example Clinic PC,EHR,doctor,Fake-Pass-6,,,,,,,",
      "3,Example Clinic PC,Fax,front,Fake-Pass-7,,,,,,,",
    );

    it("lists each organization with how many rows it has", () => {
      expect(importer.customers(twoOrganizations)).toEqual([
        { name: "Example Clinic PC", rows: 2 },
        { name: "Sample Law LLP", rows: 1 },
      ]);
    });

    it("imports only the organization chosen, and says how many it left out", async () => {
      importer.onlyCustomer = "Sample Law LLP";
      const result = await importer.parse(twoOrganizations);

      expect(result.ciphers.map((c) => c.name)).toEqual(["Wi-Fi"]);
      expect(result.leftOut).toEqual(["Left out 2 passwords for other IT Glue organizations."]);
    });
  });

  it("reads a list view's export, with the names the screens use", async () => {
    const result = await importer.parse(
      "Organization,Name,Category,Username,Password,URL,Notes,One-time Password\n" +
        "Sample Law LLP,Backup console,Application,ops,Fake-Pass-8,backup.example.test,,JBSWY3DPEHPK3PXP",
    );

    expect(result.success).toBe(true);
    expect(result.ciphers[0].name).toBe("Backup console");
    expect(result.ciphers[0].login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(field(result, 0, "Category")).toMatchObject({
      value: "Application",
      type: FieldType.Text,
    });
    expect(folderOf(result, 0)).toBe("Sample Law LLP");
  });

  it("imports nothing from a file with only its header, and says so", async () => {
    const result = await importer.parse(HEADER + "\n");

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This file has IT Glue's columns but no passwords in its rows, so nothing was imported.",
    );
  });

  it("imports nothing from a file whose rows are empty, and says so", async () => {
    const result = await importer.parse(csv(",,,,,,,,,,,", ",,,,,,,,,,,"));

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("nothing was imported");
  });

  it("says a file isn't IT Glue's, and which columns it lacks", async () => {
    const result = await importer.parse(
      "url,username,password\nhttps://mail.example.test,a,Fake-1",
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This isn't an IT Glue export: it has no organization, name, or password_category columns. If it came from IT Glue, choose the passwords.csv file in its export.",
    );
  });

  it("says when a file is Passportal's instead", async () => {
    const result = await importer.parse(
      "Passportal ID,Client Name,Credential Type,Username,Password,Description,Expires (Yes/No),Notes,URL,Folder,TOTP Secret\n" +
        "1,Test Dental Group,Website,a,Fake-1,Portal,No,,,,",
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "This isn't an IT Glue export: it has no organization or password_category columns. It looks like a Passportal export: choose Passportal (csv) instead.",
    );
  });

  it("refuses a file with a quote that's never closed", async () => {
    const result = await importer.parse(csv('1,Sample Law LLP,"Wi-Fi,,Fake-Pass-5,,,,,,,'));

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "The file has a quote that's never closed, so it can't be read.",
    );
  });
});
