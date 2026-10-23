import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { data as creditCardData } from "../spec-data/onepassword-csv/credit-card.mac.csv";
import { data as identityData } from "../spec-data/onepassword-csv/identity.mac.csv";
import { data as multiTypeData } from "../spec-data/onepassword-csv/multiple-items.mac.csv";

import { OnePasswordMacCsvImporter } from "./onepassword-mac-csv-importer";

function expectIdentity(cipher: CipherView) {
  expect(cipher.type).toBe(CipherType.Identity);

  expect(cipher.identity).toEqual(
    expect.objectContaining({
      firstName: "first name",
      middleName: "mi",
      lastName: "last name",
      username: "userNam3",
      company: "bitwarden",
      phone: "8005555555",
      email: "email@bitwarden.com",
    }),
  );

  expect(cipher.notes).toContain("address\ncity state zip\nUnited States");
}

function expectCreditCard(cipher: CipherView) {
  expect(cipher.type).toBe(CipherType.Card);

  expect(cipher.card).toEqual(
    expect.objectContaining({
      number: "4111111111111111",
      code: "111",
      cardholderName: "test",
      expMonth: "1",
      expYear: "2030",
    }),
  );
}

describe("1Password mac CSV Importer", () => {
  it("should parse identity records", async () => {
    const importer = new OnePasswordMacCsvImporter();
    const result = await importer.parse(identityData);

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.ciphers.length).toBe(1);
    const cipher = result.ciphers[0];
    expectIdentity(cipher);
  });

  it("should parse credit card records", async () => {
    const importer = new OnePasswordMacCsvImporter();
    const result = await importer.parse(creditCardData);

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.ciphers.length).toBe(1);
    const cipher = result.ciphers[0];
    expectCreditCard(cipher);
  });

  // Keykeeper: 1Password 8's CSV has a Url column; its address was dropped, and the notes kept
  // a newline at each end.
  it("should keep the website and notes of a 1Password 8 CSV", async () => {
    const importer = new OnePasswordMacCsvImporter();
    const result = await importer.parse(
      [
        "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes",
        "Example Mail,https://mail.example.com/login,test.person,not-a-real-password,,false,false,,A note.",
      ].join("\n"),
    );

    expect(result.ciphers.length).toBe(1);
    const cipher = result.ciphers[0];
    expect(cipher.login.uris.map((u) => u.uri)).toEqual(["https://mail.example.com/login"]);
    expect(cipher.login.username).toBe("test.person");
    expect(cipher.notes).toBe("A note.");
  });

  it("should parse csv's with multiple record type", async () => {
    const importer = new OnePasswordMacCsvImporter();
    const result = await importer.parse(multiTypeData);

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.ciphers.length).toBe(4);
    expectIdentity(result.ciphers[1]);
    expectCreditCard(result.ciphers[2]);
  });
});
