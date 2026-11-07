import { mock } from "jest-mock-extended";

import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { CipherType } from "@bitwarden/common/vault/enums";

import { DashlaneCsvImporter } from "..";
import { credentialsData_otpUrl } from "../spec-data/dashlane-csv/credentials-otpurl.csv";
import { credentialsData } from "../spec-data/dashlane-csv/credentials.csv";
import { identityData } from "../spec-data/dashlane-csv/id.csv";
import { multiplePersonalInfoData } from "../spec-data/dashlane-csv/multiple-personal-info.csv";
import { paymentsData } from "../spec-data/dashlane-csv/payments.csv";
import { personalInfoData } from "../spec-data/dashlane-csv/personal-info.csv";
import { secureNoteData } from "../spec-data/dashlane-csv/securenotes.csv";
import { assertCustomFieldsStructure } from "../spec-data/importer-test-utils";

describe("Dashlane CSV Importer", () => {
  let importer: DashlaneCsvImporter;
  const configService = mock<ConfigService>();

  // Assert that an import was successful and return it
  const getImportResult = async (data: string) => {
    const result = await importer.parse(data);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    expect(result.success).toEqual(true);
    return result;
  };

  beforeEach(() => {
    configService.getFeatureFlag.mockResolvedValue(false);
    importer = new DashlaneCsvImporter(configService);
  });

  it("should parse login records", async () => {
    const result = await getImportResult(credentialsData);

    expect(result.ciphers.length).toEqual(1);
    const cipher = result.ciphers[0];
    expect(cipher.name).toEqual("example.com");
    expect(cipher.login.username).toEqual("jdoe");
    expect(cipher.login.password).toEqual("somePassword");
    expect(cipher.login.totp).toEqual("someTOTPSeed");
    expect(cipher.login.uris.length).toEqual(1);
    const uriView = cipher.login.uris[0];
    expect(uriView.uri).toEqual("https://www.example.com");
    expect(cipher.notes).toEqual("some note for example.com");
  });

  it("should parse login with totp when given otpUrl instead of otpSecret", async () => {
    const result = await getImportResult(credentialsData_otpUrl);

    expect(result.ciphers.length).toEqual(1);
    const cipher = result.ciphers[0];
    expect(cipher.login.totp).toEqual("anotherTOTPSeed");
    // Keykeeper: and not a plain text field with the secret in it too.
    expect(cipher.fields.map((f) => f.name)).not.toContain("otpUrl");
  });

  it("should parse an item and create a folder", async () => {
    const result = await getImportResult(credentialsData);

    expect(result.folders.length).toEqual(1);
    expect(result.folders[0].name).toEqual("Entertainment");
    expect(result.folderRelationships.length).toEqual(1);
    expect(result.folderRelationships[0]).toEqual([0, 0]);
  });

  it("should parse payment records", async () => {
    const result = await importer.parse(paymentsData);

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.ciphers.length).toBe(2);

    // Account
    const cipher = result.ciphers.shift();
    expect(cipher.type).toBe(CipherType.Card);
    expect(cipher.name).toBe("John's savings account");
    expect(cipher.card.brand).toBeUndefined();
    expect(cipher.card.cardholderName).toBe("John Doe");
    expect(cipher.card.number).toBe("accountNumber");
    expect(cipher.card.code).toBeUndefined();
    expect(cipher.card.expMonth).toBeUndefined();
    expect(cipher.card.expYear).toBeUndefined();

    expect(cipher.fields.length).toBe(4);

    expect(cipher.fields[0].name).toBe("type");
    expect(cipher.fields[0].value).toBe("bank");

    expect(cipher.fields[1].name).toBe("routing_number");
    expect(cipher.fields[1].value).toBe("routingNumber");

    expect(cipher.fields[2].name).toBe("country");
    expect(cipher.fields[2].value).toBe("US");

    expect(cipher.fields[3].name).toBe("issuing_bank");
    expect(cipher.fields[3].value).toBe("US-ALLY");

    // CreditCard
    const cipher2 = result.ciphers.shift();
    expect(cipher2.type).toBe(CipherType.Card);
    // Keykeeper: named by its brand and last four digits, not its holder.
    expect(cipher2.name).toBe("Visa ending 1111");
    expect(cipher2.card.brand).toBe("Visa");
    expect(cipher2.card.cardholderName).toBe("John Doe");
    expect(cipher2.card.number).toBe("41111111111111111");
    expect(cipher2.card.code).toBe("123");
    expect(cipher2.card.expMonth).toBe("1");
    expect(cipher2.card.expYear).toBe("2023");

    // Keykeeper: "credit_card" is what made it a card, not a field.
    expect(cipher2.fields.length).toBe(1);

    expect(cipher2.fields[0].name).toBe("country");
    expect(cipher2.fields[0].value).toBe("US");
  });

  // Keykeeper: a card's own name, when the export has one.
  it("should keep a card's name when the export has one", async () => {
    const result = await importer.parse(
      [
        "type,account_name,account_holder,cc_number,code,expiration_month,expiration_year,routing_number,account_number,country,issuing_bank",
        "credit_card,Travel card,Test Person,5555555555554444,321,01,2029,,,US,",
        "credit_card,Test Person,Test Person,378282246310005,1234,07,2031,,,US,",
        "credit_card,Test Person,,0000,,,,,,US,",
      ].join("\n"),
    );

    expect(result.ciphers.map((c) => [c.name, c.card.cardholderName, c.card.brand])).toEqual([
      ["Travel card", "Test Person", "Mastercard"],
      ["Amex ending 0005", "Test Person", "Amex"],
      ["Card ending 0000", "Test Person", undefined],
    ]);
  });

  // Keykeeper: which file it is comes from its columns, not their order.
  it("should keep cards as cards when the payments file has a title column, in any order", async () => {
    const result = await importer.parse(
      [
        "title,type,account_name,account_holder,cc_number,code,expiration_month,expiration_year,country",
        "Travel card,credit_card,Test Person,,5555555555554444,321,01,2029,US",
        "Savings,bank,Test Bank,Test Person,,,,,US",
        ",paypal,Test PayPal,,,,,,US",
      ].join("\n"),
    );

    expect(result.success).toBe(true);
    expect(result.ciphers.map((c) => [c.type, c.name])).toEqual([
      [CipherType.Card, "Travel card"],
      [CipherType.Card, "Test Bank"],
      [CipherType.SecureNote, "Test PayPal"],
    ]);
    expect(result.ciphers[0].card.number).toBe("5555555555554444");
    expect(result.ciphers[2].fields.map((f) => [f.name, f.value])).toEqual([
      ["type", "paypal"],
      ["country", "US"],
    ]);
  });

  it("should refuse a file that isn't one of Dashlane's, rather than import empty items", async () => {
    const result = await importer.parse(["kind,label,secret", "x,y,z"].join("\n"));

    expect(result.success).toBe(false);
    expect(result.ciphers).toEqual([]);
  });

  describe("should parse ids records", () => {
    it("with new item types feature flag OFF", async () => {
      const result = await getImportResult(identityData);

      expect(result.ciphers.length).toEqual(5);

      // Type card
      const cipher = result.ciphers[0];
      expect(cipher.type).toEqual(CipherType.Identity);
      expect(cipher.name).toEqual("John Doe card");
      expect(cipher.identity.fullName).toEqual("John Doe");
      expect(cipher.identity.firstName).toEqual("John");
      expect(cipher.identity.middleName).toBeUndefined();
      expect(cipher.identity.lastName).toEqual("Doe");
      expect(cipher.identity.licenseNumber).toEqual("123123123");

      assertCustomFieldsStructure(cipher.fields, [
        ["type", "card"],
        ["issue_date", "2022-1-30"],
        ["expiration_date", "2032-1-30"],
      ]);

      // Type passport
      const cipher2 = result.ciphers[1];
      expect(cipher2.type).toEqual(CipherType.Identity);
      expect(cipher2.name).toEqual("John Doe passport");
      expect(cipher2.identity.fullName).toEqual("John Doe");
      expect(cipher2.identity.firstName).toEqual("John");
      expect(cipher2.identity.middleName).toBeUndefined();
      expect(cipher2.identity.lastName).toEqual("Doe");
      expect(cipher2.identity.passportNumber).toEqual("123123123");

      assertCustomFieldsStructure(cipher2.fields, [
        ["type", "passport"],
        ["issue_date", "2022-1-30"],
        ["expiration_date", "2032-1-30"],
        ["place_of_issue", "somewhere in Germany"],
      ]);

      // Type license
      const cipher3 = result.ciphers[2];
      expect(cipher3.type).toEqual(CipherType.Identity);
      expect(cipher3.name).toEqual("John Doe license");
      expect(cipher3.identity.fullName).toEqual("John Doe");
      expect(cipher3.identity.firstName).toEqual("John");
      expect(cipher3.identity.middleName).toBeUndefined();
      expect(cipher3.identity.lastName).toEqual("Doe");
      expect(cipher3.identity.licenseNumber).toEqual("1234556");
      expect(cipher3.identity.state).toEqual("DC");

      assertCustomFieldsStructure(cipher3.fields, [
        ["type", "license"],
        ["issue_date", "2022-8-10"],
        ["expiration_date", "2022-10-10"],
      ]);

      // Type social_security
      const cipher4 = result.ciphers[3];
      expect(cipher4.type).toEqual(CipherType.Identity);
      expect(cipher4.name).toEqual("John Doe social_security");
      expect(cipher4.identity.fullName).toEqual("John Doe");
      expect(cipher4.identity.firstName).toEqual("John");
      expect(cipher4.identity.middleName).toBeUndefined();
      expect(cipher4.identity.lastName).toEqual("Doe");
      expect(cipher4.identity.ssn).toEqual("123123123");

      assertCustomFieldsStructure(cipher4.fields, [["type", "social_security"]]);

      // Type tax_number
      const cipher5 = result.ciphers[4];
      expect(cipher5.type).toEqual(CipherType.Identity);
      expect(cipher5.name).toEqual("tax_number");
      expect(cipher5.identity.licenseNumber).toEqual("123123123");

      assertCustomFieldsStructure(cipher5.fields, [["type", "tax_number"]]);
    });

    it("with new item types feature flag ON", async () => {
      configService.getFeatureFlag.mockResolvedValueOnce(true);
      const result = await getImportResult(identityData);

      expect(result.ciphers.length).toEqual(5);

      // Type card
      const cipher = result.ciphers[0];
      expect(cipher.type).toEqual(CipherType.Identity);
      expect(cipher.name).toEqual("John Doe card");
      expect(cipher.identity.fullName).toEqual("John Doe");
      expect(cipher.identity.firstName).toEqual("John");
      expect(cipher.identity.middleName).toBeUndefined();
      expect(cipher.identity.lastName).toEqual("Doe");
      expect(cipher.identity.licenseNumber).toEqual("123123123");

      assertCustomFieldsStructure(cipher.fields, [
        ["type", "card"],
        ["issue_date", "2022-1-30"],
        ["expiration_date", "2032-1-30"],
      ]);

      // Type passport
      const cipher2 = result.ciphers[1];
      expect(cipher2.type).toEqual(CipherType.Passport);
      expect(cipher2.name).toEqual("John Doe passport");
      expect(cipher2.passport.givenName).toEqual("John");
      expect(cipher2.passport.surname).toEqual("Doe");
      expect(cipher2.passport.passportNumber).toEqual("123123123");
      expect(cipher2.passport.issueDate).toEqual("2022-01-30");
      expect(cipher2.passport.expirationDate).toEqual("2032-01-30");
      expect(cipher2.passport.issuingCountry).toEqual("somewhere in Germany");

      assertCustomFieldsStructure(cipher2.fields, []);

      // Type license
      const cipher3 = result.ciphers[2];
      expect(cipher3.type).toEqual(CipherType.DriversLicense);
      expect(cipher3.name).toEqual("John Doe license");
      expect(cipher3.driversLicense.firstName).toEqual("John");
      expect(cipher3.driversLicense.middleName).toBeUndefined();
      expect(cipher3.driversLicense.lastName).toEqual("Doe");
      expect(cipher3.driversLicense.licenseNumber).toEqual("1234556");
      expect(cipher3.driversLicense.issueDate).toEqual("2022-08-10");
      expect(cipher3.driversLicense.expirationDate).toEqual("2022-10-10");
      expect(cipher3.driversLicense.issuingCountry).toEqual("");
      expect(cipher3.driversLicense.issuingState).toEqual("DC");

      assertCustomFieldsStructure(cipher3.fields, []);

      // Type social_security
      const cipher4 = result.ciphers[3];
      expect(cipher4.type).toEqual(CipherType.Identity);
      expect(cipher4.name).toEqual("John Doe social_security");
      expect(cipher4.identity.fullName).toEqual("John Doe");
      expect(cipher4.identity.firstName).toEqual("John");
      expect(cipher4.identity.middleName).toBeUndefined();
      expect(cipher4.identity.lastName).toEqual("Doe");
      expect(cipher4.identity.ssn).toEqual("123123123");

      assertCustomFieldsStructure(cipher4.fields, [["type", "social_security"]]);

      // Type tax_number
      const cipher5 = result.ciphers[4];
      expect(cipher5.type).toEqual(CipherType.Identity);
      expect(cipher5.name).toEqual("tax_number");
      expect(cipher5.identity.licenseNumber).toEqual("123123123");

      assertCustomFieldsStructure(cipher5.fields, [["type", "tax_number"]]);
    });
  });

  it("should parse secureNote records", async () => {
    const result = await getImportResult(secureNoteData);

    expect(result.ciphers.length).toEqual(1);

    const cipher = result.ciphers[0];
    expect(cipher.type).toEqual(CipherType.SecureNote);
    expect(cipher.name).toEqual("01");
    expect(cipher.notes).toEqual("test");
  });

  // Keykeeper: an identity for each person, not a secure note for each row.
  it("should make an identity for each person in personal information records", async () => {
    const result = await importer.parse(multiplePersonalInfoData);

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.ciphers.length).toBe(2);

    const [john, jane] = result.ciphers;
    expect(john.type).toBe(CipherType.Identity);
    expect(john.name).toBe("MR John Doe");
    expect(john.identity.title).toBe("MR");
    expect(john.identity.firstName).toBe("John");
    expect(john.identity.lastName).toBe("Doe");
    expect(john.identity.username).toBe("jdoe");
    expect(john.identity.email).toBe("jdoe@example.com");
    expect(john.identity.phone).toBe("+49123123123");
    expect(john.identity.address1).toBe("1 some street");
    expect(john.identity.city).toBe("some city");
    expect(john.identity.postalCode).toBe("123123");
    expect(john.identity.state).toBe("DE-0-NW");
    expect(john.identity.country).toBe("de");
    expect(john.fields.map((f) => f.name)).toEqual([
      "date_of_birth",
      "place_of_birth",
      "email_type",
      "address_recipient",
      "address_building",
      "address_apartment",
      "address_floor",
      "address_door_code",
      "url",
    ]);

    expect(jane.type).toBe(CipherType.Identity);
    expect(jane.name).toBe("Mrs Jane Doe");
    expect(jane.identity.firstName).toBe("Jane");
    expect(jane.identity.email).toBeUndefined();
    expect(jane.fields.map((f) => [f.name, f.value])).toEqual([
      ["date_of_birth", "2022-01-30"],
      ["place_of_birth", "earth"],
    ]);
  });

  it("should give each person the rows that name them, in any order", async () => {
    const header =
      "type,title,first_name,middle_name,last_name,login,date_of_birth,place_of_birth,email,email_type,item_name,phone_number,address,country,state,city,zip,address_recipient,address_building,address_apartment,address_floor,address_door_code,job_title,url";
    const empty = header.split(",").map(() => "");
    const row = (values: Record<string, string>) =>
      header
        .split(",")
        .map((column, i) => values[column] ?? empty[i])
        .join(",");
    const result = await importer.parse(
      [
        header,
        row({ type: "name", first_name: "Test", last_name: "Person" }),
        row({ type: "name", first_name: "Zoë", last_name: "Ångström" }),
        row({ type: "email", email: "test.person@example.com", item_name: "Test's email" }),
        row({ type: "email", email: "zoe@example.com", item_name: "Zoës email" }),
        row({ type: "email", email: "test.work@example.com", item_name: "Test's work email" }),
        row({ type: "number", phone_number: "+1 555 0100", item_name: "Phone" }),
        row({
          type: "address",
          address: "1 Example Street",
          city: "Malmö",
          address_recipient: "Zoë Ångström",
        }),
      ].join("\n"),
    );

    expect(result.ciphers.map((c) => c.type)).toEqual([CipherType.Identity, CipherType.Identity]);
    const [test, zoe] = result.ciphers;
    expect(test.name).toBe("Test Person");
    expect(test.identity.email).toBe("test.person@example.com");
    // A second email is a field rather than written over the first.
    expect(test.fields.map((f) => [f.name, f.value])).toEqual([
      ["Test's work email", "test.work@example.com"],
    ]);
    expect(zoe.name).toBe("Zoë Ångström");
    expect(zoe.identity.email).toBe("zoe@example.com");
    // Naming no one, it's the most recent person's.
    expect(zoe.identity.phone).toBe("+1 555 0100");
    expect(zoe.identity.address1).toBe("1 Example Street");
    expect(zoe.identity.city).toBe("Malmö");
  });

  it("should combine personal information records to one identity if only one identity present", async () => {
    const result = await getImportResult(personalInfoData);

    expect(result.ciphers.length).toEqual(1);
    const cipher = result.ciphers[0];
    expect(cipher.type).toEqual(CipherType.Identity);
    expect(cipher.name).toEqual("MR John Doe");
    expect(cipher.identity.fullName).toEqual("MR John Doe");
    expect(cipher.identity.title).toEqual("MR");
    expect(cipher.identity.firstName).toEqual("John");
    expect(cipher.identity.middleName).toBeUndefined();
    expect(cipher.identity.lastName).toEqual("Doe");
    expect(cipher.identity.username).toEqual("jdoe");
    expect(cipher.identity.email).toEqual("jdoe@example.com");
    expect(cipher.identity.phone).toEqual("+49123123123");

    assertCustomFieldsStructure(cipher.fields, [
      ["date_of_birth", "2022-01-30"],
      ["place_of_birth", "world"],
      ["email_type", "personal"],
      ["address_recipient", "John"],
      ["address_building", "1"],
      ["address_apartment", "1"],
      ["address_floor", "1"],
      ["address_door_code", "123"],
      ["url", "website.com"],
    ]);
  });
});
