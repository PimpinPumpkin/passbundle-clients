import { mock } from "jest-mock-extended";

import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { FieldType, CipherType, BankAccountType } from "@bitwarden/common/vault/enums";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { ImportResult } from "../../models/import-result";

import { LastPassCsvImporter } from "./lastpass-csv-importer";

function baseExcept(result: ImportResult) {
  expect(result).not.toBeNull();
  expect(result.success).toBe(true);
  expect(result.ciphers.length).toBe(1);
}

function expectLogin(cipher: CipherView) {
  expect(cipher.type).toBe(CipherType.Login);

  expect(cipher.name).toBe("example.com");
  expect(cipher.notes).toBe("super secure notes");
  expect(cipher.login.uri).toBe("http://example.com");
  expect(cipher.login.username).toBe("someUser");
  expect(cipher.login.password).toBe("myPassword");
  expect(cipher.login.totp).toBe("Y64VEVMBTSXCYIWRSHRNDZW62MPGVU2G");
}

const CipherData = [
  {
    title: "should parse expiration date",
    csv: `url,username,password,extra,name,grouping,fav
http://sn,,,"NoteType:Credit Card
Name on Card:John Doe
Type:
Number:1234567812345678
Security Code:123
Start Date:October,2017
Expiration Date:June,2020
Notes:some text
",Credit-card,,0`,
    expected: Object.assign(new CipherView(), {
      name: "Credit-card",
      notes: "some text\n",
      type: 3,
      card: Object.assign(new CardView(), {
        cardholderName: "John Doe",
        number: "1234567812345678",
        code: "123",
        expYear: "2020",
        expMonth: "6",
      }),
      fields: [
        Object.assign(new FieldView(), {
          name: "Start Date",
          value: "October,2017",
          type: FieldType.Text,
        }),
      ],
    }),
  },
  {
    title: "should parse blank card note",
    csv: `url,username,password,extra,name,grouping,fav
http://sn,,,"NoteType:Credit Card
Name on Card:
Type:
Number:
Security Code:
Start Date:,
Expiration Date:,
Notes:",empty,,0`,
    expected: Object.assign(new CipherView(), {
      name: "empty",
      type: 3,
      card: Object.assign(new CardView(), {
        expMonth: undefined,
      }),
      // Keykeeper: a start date with no month or year isn't a field.
      fields: [],
    }),
  },
  {
    title: "should parse card expiration date w/ no exp year",
    csv: `url,username,password,extra,name,grouping,fav
http://sn,,,"NoteType:Credit Card
Name on Card:John Doe
Type:Visa
Number:1234567887654321
Security Code:321
Start Date:,
Expiration Date:January,
Notes:",noyear,,0`,
    expected: Object.assign(new CipherView(), {
      name: "noyear",
      type: 3,
      card: Object.assign(new CardView(), {
        cardholderName: "John Doe",
        number: "1234567887654321",
        code: "321",
        expMonth: "1",
        // Keykeeper: the type is the brand when the number doesn't say.
        brand: "Visa",
      }),
      fields: [],
    }),
  },
  {
    title: "should parse card expiration date w/ no month",
    csv: `url,username,password,extra,name,grouping,fav
http://sn,,,"NoteType:Credit Card
Name on Card:John Doe
Type:Mastercard
Number:8765432112345678
Security Code:987
Start Date:,
Expiration Date:,2020
Notes:",nomonth,,0`,
    expected: Object.assign(new CipherView(), {
      name: "nomonth",
      type: 3,
      card: Object.assign(new CardView(), {
        cardholderName: "John Doe",
        number: "8765432112345678",
        code: "987",
        expYear: "2020",
        expMonth: undefined,
        brand: "Mastercard",
      }),
      fields: [],
    }),
  },
];

const BankAccountCSV = `url,username,password,totp,extra,name,grouping,fav
http://sn,,,,"NoteType:Bank Account
Language:
Bank Name:Bank of the Shire
Account Type:Checking
Routing Number:123456
Account Number:1234567890
SWIFT Code:123
IBAN Number:1234
Pin:1111
Branch Address:1 Main Street, Bree, Bree-hill, Eriador
Branch Phone:1112223333
Notes:",Test Bank Account,Tools Test Items,0`;

const PassportCSV = `url,username,password,totp,extra,name,grouping,fav
http://sn,,,,"NoteType:Passport
Language:en-US
Type:Shire Passport
Name:Bilbo Baggins
Country:The Shire
Number:1234567890
Sex:Male
Nationality:Shire-folk
Issuing Authority:The Shire
Date of Birth:September,22,2890
Issued Date:June,19,2941
Expiration Date:June,19,2951
Notes:",Test Passport,Tools Test Items,0`;

const DriversLicenseCSV = `url,username,password,totp,extra,name,grouping,fav
http://sn,,,,"NoteType:Driver's License
Language:en-US
Number:1234567890
Expiration Date:September,22,2926
License Class:D
Name:Bilbo Baggins
Address:Bag End, Bagshot Row, Underhill
City / Town:Hobbiton
State:Westfarthing
ZIP / Postal Code:00000
Country:The Shire
Date of Birth:September,22,2890
Sex:Male
Height:4'0""
Notes:",Test Drivers License,Tools Test Items,0`;

describe("Lastpass CSV Importer", () => {
  const configService = mock<ConfigService>();

  beforeEach(() => {
    // By default disable all feature flags
    configService.getFeatureFlag.mockResolvedValue(false);
  });

  CipherData.forEach((data) => {
    it(data.title, async () => {
      jest.useFakeTimers().setSystemTime(data.expected.creationDate);
      const importer = new LastPassCsvImporter(configService);
      const result = await importer.parse(data.csv);
      expect(result != null).toBe(true);
      expect(result.ciphers.length).toEqual(1);

      const cipher = result.ciphers[0];
      let property: keyof typeof data.expected;
      for (property in data.expected) {
        // eslint-disable-next-line
        if (data.expected.hasOwnProperty(property)) {
          // eslint-disable-next-line
          expect(cipher.hasOwnProperty(property)).toBe(true);
          expect(cipher[property]).toEqual(data.expected[property]);
        }
      }
    });
  });

  // Keykeeper: a card's brand, and only what's the card's own as fields.
  it("should give a card its brand from the number, without LastPass's own fields", async () => {
    const result = await new LastPassCsvImporter(configService)
      .parse(`url,username,password,totp,extra,name,grouping,fav
http://sn,,,,"NoteType:Credit Card
Language:en-US
Name on Card:Test Person
Type:Visa
Number:4111111111111111
Security Code:123
Start Date:,
Expiration Date:December,2030
Notes:Not a real card.",Test Visa,Finance,1`);

    const cipher = result.ciphers[0];
    expect(cipher.type).toBe(CipherType.Card);
    expect(cipher.card.brand).toBe("Visa");
    expect(cipher.card.number).toBe("4111111111111111");
    expect(cipher.card.expMonth).toBe("12");
    expect(cipher.card.expYear).toBe("2030");
    expect(cipher.fields).toEqual([]);
    expect(cipher.notes).toBe("Not a real card.");
  });

  it("should keep a card type that isn't its brand, and a real start date, as fields", async () => {
    const result = await new LastPassCsvImporter(configService)
      .parse(`url,username,password,totp,extra,name,grouping,fav
http://sn,,,,"NoteType:Credit Card
Language:en-US
Name on Card:Test Person
Type:Debit
Number:5555555555554444
Security Code:321
Start Date:March,2024
Expiration Date:January,2029
Notes:",Test Mastercard,,0`);

    const cipher = result.ciphers[0];
    expect(cipher.card.brand).toBe("Mastercard");
    expect(cipher.fields.map((f) => [f.name, f.value])).toEqual([
      ["Type", "Debit"],
      ["Start Date", "March,2024"],
    ]);
  });

  it("should give an address its phone, without LastPass's language", async () => {
    const result = await new LastPassCsvImporter(configService)
      .parse(`url,username,password,totp,extra,name,grouping,fav
http://sn,,,,"NoteType:Address
Language:en-US
First Name:Test
Last Name:Person
Address 1:1 Example Street
City / Town:Exampleville
Phone:{""num"":""5550100"",""ext"":""12"",""cc3l"":""USA""}
Mobile Phone:{""num"":""5550199"",""ext"":"""",""cc3l"":""USA""}
Fax:
Notes:",Test Person,,0
http://sn,,,,"NoteType:Address
Language:en-US
First Name:Zoë
Phone:+1 555 0100
Notes:",Zoë,,0`);

    const [json, plain] = result.ciphers;
    expect(json.type).toBe(CipherType.Identity);
    expect(json.identity.phone).toBe("5550100 ext. 12");
    expect(json.fields.map((f) => [f.name, f.value])).toEqual([["Mobile Phone", "5550199"]]);
    expect(plain.identity.phone).toBe("+1 555 0100");
    expect(plain.fields).toEqual([]);
  });

  it("reads a long phone value at once, as it is (Keykeeper)", async () => {
    // A pattern took seconds on this, growing with the length squared.
    const long = "{" + '""num""'.repeat(20000);
    const started = Date.now();
    const result = await new LastPassCsvImporter(configService)
      .parse(`url,username,password,totp,extra,name,grouping,fav
http://sn,,,,"NoteType:Address
First Name:Test
Phone:${long}
Notes:",Test Person,,0`);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.ciphers[0].identity.phone).toBe(long.replace(/""/g, '"'));
  });

  it("should parse login with totp", async () => {
    const input = `url,username,password,totp,extra,name,grouping,fav
        http://example.com,someUser,myPassword,Y64VEVMBTSXCYIWRSHRNDZW62MPGVU2G,super secure notes,example.com,,0`;

    const importer = new LastPassCsvImporter(configService);
    const result = await importer.parse(input);
    baseExcept(result);

    const cipher = result.ciphers[0];
    expectLogin(cipher);
  });

  describe("should parse bank account record", () => {
    it("with new item types feature flag OFF", async () => {
      const importer = new LastPassCsvImporter(configService);
      const result = await importer.parse(BankAccountCSV);
      expect(result != null).toBe(true);
      expect(result.ciphers.length).toEqual(1);

      const cipher = result.ciphers[0];
      expect(cipher.name).toEqual("Test Bank Account");
      expect(cipher.type).toEqual(CipherType.SecureNote);
      expect(cipher.notes).toEqual(`NoteType:Bank Account
Language:
Bank Name:Bank of the Shire
Account Type:Checking
Routing Number:123456
Account Number:1234567890
SWIFT Code:123
IBAN Number:1234
Pin:1111
Branch Address:1 Main Street, Bree, Bree-hill, Eriador
Branch Phone:1112223333
Notes:`);
    });

    it("with new item types feature flag ON", async () => {
      configService.getFeatureFlag.mockResolvedValueOnce(true);
      const importer = new LastPassCsvImporter(configService);
      const result = await importer.parse(BankAccountCSV);
      expect(result != null).toBe(true);
      expect(result.ciphers.length).toEqual(1);

      const cipher = result.ciphers[0];
      expect(cipher.name).toEqual("Test Bank Account");
      expect(cipher.type).toEqual(CipherType.BankAccount);
      expect(cipher.bankAccount.bankName).toEqual("Bank of the Shire");
      expect(cipher.bankAccount.accountType).toEqual(BankAccountType.Checking);
      expect(cipher.bankAccount.routingNumber).toEqual("123456");
      expect(cipher.bankAccount.accountNumber).toEqual("1234567890");
      expect(cipher.bankAccount.swiftCode).toEqual("123");
      expect(cipher.bankAccount.iban).toEqual("1234");
      expect(cipher.bankAccount.pin).toEqual("1111");
      expect(cipher.bankAccount.bankContactPhone).toEqual("1112223333");
    });
  });

  describe("should parse passport record", () => {
    it("with new item types feature flag OFF", async () => {
      const importer = new LastPassCsvImporter(configService);
      const result = await importer.parse(PassportCSV);
      expect(result != null).toBe(true);
      expect(result.ciphers.length).toEqual(1);

      const cipher = result.ciphers[0];
      expect(cipher.name).toEqual("Test Passport");
      expect(cipher.type).toEqual(CipherType.SecureNote);
      expect(cipher.notes).toEqual(`NoteType:Passport
Language:en-US
Type:Shire Passport
Name:Bilbo Baggins
Country:The Shire
Number:1234567890
Sex:Male
Nationality:Shire-folk
Issuing Authority:The Shire
Date of Birth:September,22,2890
Issued Date:June,19,2941
Expiration Date:June,19,2951
Notes:`);
    });

    it("with new item types feature flag ON", async () => {
      configService.getFeatureFlag.mockResolvedValueOnce(true);
      const importer = new LastPassCsvImporter(configService);
      const result = await importer.parse(PassportCSV);
      expect(result != null).toBe(true);
      expect(result.ciphers.length).toEqual(1);

      const cipher = result.ciphers[0];
      expect(cipher.name).toEqual("Test Passport");
      expect(cipher.type).toEqual(CipherType.Passport);
      expect(cipher.passport.passportType).toEqual("Shire Passport");
      expect(cipher.passport.givenName).toEqual("Bilbo");
      expect(cipher.passport.surname).toEqual("Baggins");
      expect(cipher.passport.issuingCountry).toEqual("The Shire");
      expect(cipher.passport.passportNumber).toEqual("1234567890");
      expect(cipher.passport.nationality).toEqual("Shire-folk");
      expect(cipher.passport.issuingAuthority).toEqual("The Shire");
      expect(cipher.passport.dateOfBirth).toEqual("2890-09-22");
      expect(cipher.passport.issueDate).toEqual("2941-06-19");
      expect(cipher.passport.expirationDate).toEqual("2951-06-19");
    });
  });

  describe("should parse drivers license record", () => {
    it("with new item types feature flag OFF", async () => {
      const importer = new LastPassCsvImporter(configService);
      const result = await importer.parse(DriversLicenseCSV);
      expect(result != null).toBe(true);
      expect(result.ciphers.length).toEqual(1);

      const cipher = result.ciphers[0];
      expect(cipher.name).toEqual("Test Drivers License");
      expect(cipher.type).toEqual(CipherType.SecureNote);
      expect(cipher.notes).toEqual(`NoteType:Driver's License
Language:en-US
Number:1234567890
Expiration Date:September,22,2926
License Class:D
Name:Bilbo Baggins
Address:Bag End, Bagshot Row, Underhill
City / Town:Hobbiton
State:Westfarthing
ZIP / Postal Code:00000
Country:The Shire
Date of Birth:September,22,2890
Sex:Male
Height:4'0"
Notes:`);
    });

    it("with new item types feature flag ON", async () => {
      configService.getFeatureFlag.mockResolvedValueOnce(true);
      const importer = new LastPassCsvImporter(configService);
      const result = await importer.parse(DriversLicenseCSV);
      expect(result != null).toBe(true);
      expect(result.ciphers.length).toEqual(1);

      const cipher = result.ciphers[0];
      expect(cipher.name).toEqual("Test Drivers License");
      expect(cipher.type).toEqual(CipherType.DriversLicense);
      expect(cipher.driversLicense.licenseNumber).toEqual("1234567890");
      expect(cipher.driversLicense.expirationDate).toEqual("2926-09-22");
      expect(cipher.driversLicense.licenseClass).toEqual("D");
      expect(cipher.driversLicense.firstName).toEqual("Bilbo");
      expect(cipher.driversLicense.middleName).toBeUndefined();
      expect(cipher.driversLicense.lastName).toEqual("Baggins");
      expect(cipher.driversLicense.issuingState).toEqual("Westfarthing");
      expect(cipher.driversLicense.issuingCountry).toEqual("The Shire");
      expect(cipher.driversLicense.dateOfBirth).toEqual("2890-09-22");
    });
  });
});
