// Keykeeper: a copy (Clone) of an item whose secrets the person can't see
// carries none of them (DESIGN.md, "Folders and permissions"). Every page
// refuses such a copy; this is the form's backstop. These tests render the
// whole item form, with its real sections, which start from the item and
// write their values back, and check what the form sends to the server.
import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { ViewCacheService } from "@bitwarden/angular/platform/view-cache";
import { NudgesService } from "@bitwarden/angular/vault";
import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AutofillSettingsServiceAbstraction } from "@bitwarden/common/autofill/services/autofill-settings.service";
import { DomainSettingsService } from "@bitwarden/common/autofill/services/domain-settings.service";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { ClientType, DeviceType } from "@bitwarden/common/enums";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { SdkService } from "@bitwarden/common/platform/abstractions/sdk/sdk.service";
import { CipherArchiveService } from "@bitwarden/common/vault/abstractions/cipher-archive.service";
import { CipherType, FieldType, LoginLinkedId } from "@bitwarden/common/vault/enums";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { BankAccountView } from "@bitwarden/common/vault/models/view/bank-account.view";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DriversLicenseView } from "@bitwarden/common/vault/models/view/drivers-license.view";
import { Fido2CredentialView } from "@bitwarden/common/vault/models/view/fido2-credential.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { PassportView } from "@bitwarden/common/vault/models/view/passport.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";
import { SshKeyView } from "@bitwarden/common/vault/models/view/ssh-key.view";
import { DialogService, ToastService } from "@bitwarden/components";

import { CipherFormConfig } from "../cipher-form/abstractions/cipher-form-config.service";
import { CipherFormGenerationService } from "../cipher-form/abstractions/cipher-form-generation.service";
import { CipherFormService } from "../cipher-form/abstractions/cipher-form.service";
import { TotpCaptureService } from "../cipher-form/abstractions/totp-capture.service";
import { CipherFormComponent } from "../cipher-form/components/cipher-form.component";
import { CustomFieldsComponent } from "../cipher-form/components/custom-fields/custom-fields.component";
import { CipherFormCacheService } from "../cipher-form/services/default-cipher-form-cache.service";
import { PasswordRepromptService } from "../services/password-reprompt.service";
import { SshImportPromptService } from "../services/ssh-import-prompt.service";

const SECRETS = [
  "hunter2",
  "JBSWY3DPEHPK3PXP",
  "4421-8830",
  "older-password",
  "PASSKEY-KEY",
  "4242424242424242",
  "987",
  "078-05-1120",
  "P1234567",
  "D7654321",
  "ACCT-9988776655",
  "77441199",
  "IBAN-GB33",
  "SWIFT-BOFA",
  "NID-55-66",
  "PRIVATE-KEY",
];

/** Each kind of item, with every secret it has and some plain values. */
function source(type: CipherType): CipherView {
  const item = new CipherView();
  item.id = "source-id";
  item.type = type;
  item.name = "Clinic item";
  item.notes = "Front desk";
  item.viewPassword = false;
  item.edit = true;
  item.fields = [
    Object.assign(new FieldView(), {
      name: "Router PIN",
      value: "4421-8830",
      type: FieldType.Hidden,
    }),
    Object.assign(new FieldView(), { name: "Site", value: "Main office", type: FieldType.Text }),
  ];
  switch (type) {
    case CipherType.Login:
      item.login.username = "frontdesk";
      item.login.password = "hunter2";
      item.login.totp = "JBSWY3DPEHPK3PXP";
      item.login.uris = [Object.assign(new LoginUriView(), { uri: "https://clinic.test" })];
      item.login.fido2Credentials = [
        Object.assign(new Fido2CredentialView(), { keyValue: "PASSKEY-KEY" }),
      ];
      item.passwordHistory = [
        Object.assign(new PasswordHistoryView(), {
          password: "older-password",
          lastUsedDate: new Date(),
        }),
      ];
      item.fields.push(
        Object.assign(new FieldView(), {
          name: "Linked password",
          type: FieldType.Linked,
          linkedId: LoginLinkedId.Password,
        }),
      );
      break;
    case CipherType.Card:
      item.card = Object.assign(new CardView(), {
        cardholderName: "Lakeside Clinic",
        code: "987",
        expMonth: "4",
        expYear: "2030",
      });
      item.card.number = "4242424242424242";
      break;
    case CipherType.Identity:
      item.identity = Object.assign(new IdentityView(), {
        ssn: "078-05-1120",
        passportNumber: "P1234567",
        licenseNumber: "D7654321",
        email: "pat@clinic.test",
      });
      item.identity.firstName = "Pat";
      break;
    case CipherType.BankAccount:
      item.bankAccount = Object.assign(new BankAccountView(), {
        bankName: "First Bank",
        accountNumber: "ACCT-9988776655",
        pin: "77441199",
        iban: "IBAN-GB33",
        swiftCode: "SWIFT-BOFA",
        routingNumber: "021000021",
      });
      break;
    case CipherType.DriversLicense:
      item.driversLicense = Object.assign(new DriversLicenseView(), {
        firstName: "Pat",
        licenseNumber: "D7654321",
      });
      break;
    case CipherType.Passport:
      item.passport = Object.assign(new PassportView(), {
        givenName: "Pat",
        passportNumber: "P1234567",
        nationalIdentificationNumber: "NID-55-66",
      });
      break;
    case CipherType.SshKey:
      item.sshKey = Object.assign(new SshKeyView(), {
        privateKey: "PRIVATE-KEY",
        publicKey: "ssh-ed25519 AAAA",
        keyFingerprint: "SHA256:abc",
      });
      break;
  }
  return item;
}

/** Everything a saved item holds, as one string. */
function holds(item: CipherView): string {
  return (
    JSON.stringify(item, (_key, value) => (value instanceof Map ? [...value] : value)) +
    [
      item.login?.password,
      item.login?.totp,
      item.card?.number,
      item.card?.code,
      item.sshKey?.privateKey,
    ].join(" ")
  );
}

describe("copying an item whose secrets the person can't see, through the whole form", () => {
  let fixture: ComponentFixture<CipherFormComponent>;
  const saveCipher = jest.fn();
  let decrypted: (type: CipherType) => CipherView;
  let cached: CipherView | null = null;

  beforeEach(async () => {
    saveCipher.mockReset();
    saveCipher.mockImplementation(async (item: CipherView) => item);
    cached = null;

    await TestBed.configureTestingModule({
      imports: [CipherFormComponent],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: ToastService, useValue: mock<ToastService>() },
        { provide: DialogService, useValue: mock<DialogService>() },
        {
          provide: CipherFormService,
          useValue: {
            saveCipher,
            decryptCipher: async (cipher: Cipher) => decrypted(cipher.type),
          },
        },
        {
          provide: CipherFormCacheService,
          useValue: {
            getCachedCipherView: () => cached,
            cacheCipherView: jest.fn(),
            clearCache: jest.fn(),
            get initializedWithValue() {
              return cached != null;
            },
          },
        },
        { provide: ViewCacheService, useValue: { signal: () => signal(null) } },
        {
          provide: ConfigService,
          useValue: {
            getFeatureFlag: () => Promise.resolve(false),
            getFeatureFlag$: () => new BehaviorSubject(false),
          },
        },
        {
          provide: AccountService,
          useValue: { activeAccount$: new BehaviorSubject({ id: "ana", email: "ana@test" }) },
        },
        {
          provide: CipherArchiveService,
          useValue: { userCanArchive$: () => of(false) },
        },
        {
          provide: NudgesService,
          useValue: {
            showNudge$: () =>
              new BehaviorSubject({ hasBadgeDismissed: true, hasSpotlightDismissed: true }),
            showNudgeSpotlight$: () => new BehaviorSubject(false),
          },
        },
        { provide: PasswordRepromptService, useValue: { enabled$: new BehaviorSubject(true) } },
        { provide: SshImportPromptService, useValue: mock<SshImportPromptService>() },
        {
          provide: CipherFormGenerationService,
          useValue: {
            generateInitialPassword: () => Promise.resolve(""),
            generatePassword: () => Promise.resolve("random-password"),
            generateUsername: () => Promise.resolve("random-username"),
          },
        },
        {
          provide: TotpCaptureService,
          useValue: { captureTotpSecret: () => Promise.resolve(""), canCaptureTotp: () => false },
        },
        { provide: AuditService, useValue: { passwordLeaked: () => Promise.resolve(0) } },
        {
          provide: DomainSettingsService,
          useValue: {
            resolvedDefaultUriMatchStrategy$: new BehaviorSubject(UriMatchStrategy.Domain),
            defaultUriMatchStrategy$: new BehaviorSubject(UriMatchStrategy.Domain),
            defaultUriMatchStrategyPolicy$: new BehaviorSubject(null),
          },
        },
        {
          provide: AutofillSettingsServiceAbstraction,
          useValue: { autofillOnPageLoadDefault$: new BehaviorSubject(false) },
        },
        { provide: EventCollectionService, useValue: { collect: () => Promise.resolve() } },
        {
          provide: PlatformUtilsService,
          useValue: {
            getClientType: () => ClientType.Web,
            getDevice: () => DeviceType.ChromeBrowser,
          },
        },
        { provide: PolicyService, useValue: { policiesByType$: () => new BehaviorSubject([]) } },
        { provide: SdkService, useValue: mock<SdkService>() },
      ],
    }).compileComponents();
  });

  /** Opens the form to copy an item of this kind, lets every section write, and saves. */
  async function copyAndSave(
    type: CipherType,
    seesPasswords: boolean,
    mode: "clone" | "edit" = "clone",
  ): Promise<CipherView> {
    await open(type, seesPasswords, mode);
    // Each section writes all its values back, as it does on any change.
    for (const section of Object.values(fixture.componentInstance["cipherForm"].controls)) {
      section.updateValueAndValidity();
    }
    await fixture.componentInstance.submit();
    expect(saveCipher).toHaveBeenCalledTimes(1);
    return saveCipher.mock.calls[0][0] as CipherView;
  }

  /** Opens the form on an item of this kind. */
  async function open(
    type: CipherType,
    seesPasswords: boolean,
    mode: "clone" | "edit" = "clone",
  ): Promise<void> {
    decrypted = (kind) => {
      const item = source(kind);
      item.viewPassword = seesPasswords;
      return item;
    };
    const original = new Cipher();
    original.id = "source-id";
    original.type = type;
    original.viewPassword = seesPasswords;
    original.edit = true;
    original.collectionIds = [];

    fixture = TestBed.createComponent(CipherFormComponent);
    fixture.componentInstance.config = {
      mode,
      cipherType: type,
      admin: false,
      organizationDataOwnershipDisabled: true,
      originalCipher: original,
      collections: [],
      folders: [],
      organizations: [],
    } as CipherFormConfig;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const KINDS: [string, CipherType][] = [
    ["login", CipherType.Login],
    ["card", CipherType.Card],
    ["identity", CipherType.Identity],
    ["bank account", CipherType.BankAccount],
    ["driver's license", CipherType.DriversLicense],
    ["passport", CipherType.Passport],
    ["SSH key", CipherType.SshKey],
  ];

  it.each(KINDS)("a %s: none of its secrets reach the server", async (_name, type) => {
    const saved = await copyAndSave(type, false);

    const held = holds(saved);
    for (const secret of SECRETS) {
      expect(held).not.toContain(secret);
    }
    expect(saved.id).toBeFalsy();
    expect(saved.name).toMatch(/^Clinic item/);
    expect(saved.notes).toBe("Front desk");
    expect(saved.fields.map((f) => f.name)).toEqual(["Site"]);
    expect(saved.passwordHistory ?? []).toEqual([]);
    expect(saved.login?.fido2Credentials ?? []).toEqual([]);
  });

  it("a login keeps its plain values: the username and the website", async () => {
    const saved = await copyAndSave(CipherType.Login, false);
    expect(saved.login.username).toBe("frontdesk");
    expect(saved.login.uris.map((u) => u.uri)).toEqual(["https://clinic.test"]);
  });

  it("a copy the form had cached with secrets in it still sends none", async () => {
    const leaked = source(CipherType.Login);
    leaked.id = null;
    cached = leaked;
    const saved = await copyAndSave(CipherType.Login, false);
    const held = holds(saved);
    for (const secret of SECRETS) {
      expect(held).not.toContain(secret);
    }
  });

  it("someone who can see passwords still copies them", async () => {
    const saved = await copyAndSave(CipherType.Login, true);
    expect(saved.login.password).toBe("hunter2");
    expect(saved.login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(saved.fields.map((f) => f.name)).toContain("Router PIN");
  });

  describe("editing without see passwords", () => {
    const LOCKED: [string, CipherType, string, string[], (item: CipherView) => unknown[]][] = [
      [
        "identity",
        CipherType.Identity,
        "identityDetails",
        ["ssn", "passportNumber", "licenseNumber"],
        (item) => [item.identity.ssn, item.identity.passportNumber, item.identity.licenseNumber],
      ],
      [
        "bank account",
        CipherType.BankAccount,
        "bankAccountDetails",
        ["accountNumber", "pin", "iban", "swiftCode"],
        (item) => [
          item.bankAccount.accountNumber,
          item.bankAccount.pin,
          item.bankAccount.iban,
          item.bankAccount.swiftCode,
        ],
      ],
      [
        "passport",
        CipherType.Passport,
        "passportDetails",
        ["passportNumber", "nationalIdentificationNumber"],
        (item) => [item.passport.passportNumber, item.passport.nationalIdentificationNumber],
      ],
      [
        "driver's license",
        CipherType.DriversLicense,
        "driversLicenseDetails",
        ["licenseNumber"],
        (item) => [item.driversLicense.licenseNumber],
      ],
    ];

    it.each(LOCKED)(
      "a %s's secret inputs are locked, and a save keeps them as they are",
      async (_name, type, section, controls, values) => {
        await open(type, false, "edit");
        const group = fixture.componentInstance["cipherForm"].get(section)!;
        for (const name of controls) {
          expect(group.get(name)!.disabled).toBe(true);
        }

        group.updateValueAndValidity();
        await fixture.componentInstance.submit();
        const saved = saveCipher.mock.calls[0][0] as CipherView;
        expect(values(saved)).toEqual(values(source(type)));
      },
    );

    it.each(LOCKED)(
      "a %s's secret inputs stay locked when the form is enabled again",
      async (_name, type, section, controls) => {
        await open(type, false, "edit");
        fixture.componentInstance.disableFormFields();
        fixture.componentInstance.enableFormFields();
        const group = fixture.componentInstance["cipherForm"].get(section)!;
        for (const name of controls) {
          expect(group.get(name)!.disabled).toBe(true);
        }
      },
    );

    it.each(LOCKED)(
      "a %s's inputs stay open to someone who can see passwords",
      async (_n, type, section, controls) => {
        await open(type, true, "edit");
        const group = fixture.componentInstance["cipherForm"].get(section)!;
        for (const name of controls) {
          expect(group.get(name)!.disabled).toBe(false);
        }
      },
    );

    it("a linked field can't be pointed at the password", async () => {
      await open(CipherType.Login, false, "edit");
      const fields = fixture.debugElement.query(By.directive(CustomFieldsComponent))
        .componentInstance as CustomFieldsComponent;
      const secret = Object.fromEntries(
        fields.linkedFieldOptions.map((option) => [option.value, option.secret]),
      );
      expect(secret[LoginLinkedId.Password]).toBe(true);
      expect(secret[LoginLinkedId.Username]).toBe(false);
    });

    it("someone who can see passwords may link to anything", async () => {
      await open(CipherType.Login, true, "edit");
      const fields = fixture.debugElement.query(By.directive(CustomFieldsComponent))
        .componentInstance as CustomFieldsComponent;
      expect(fields.linkedFieldOptions.every((option) => !option.secret)).toBe(true);
    });
  });
});
