import { ComponentFixture, TestBed } from "@angular/core/testing";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { EXPIRES_FIELD_NAME } from "@bitwarden/common/vault/keykeeper/expiration";
import { templateFields } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { CipherFormContainer } from "../cipher-form/cipher-form-container";

import { KeykeeperExpirationFieldComponent } from "./expiration-field.component";
import { KeykeeperExpiresLink } from "./expires-link";

// Keykeeper: "Expires" and a template's expiration date field, kept the same
// (DESIGN.md, "A date field that sets Expires").
describe("KeykeeperExpirationFieldComponent and a template's expiration date field", () => {
  let fixture: ComponentFixture<KeykeeperExpirationFieldComponent>;
  let patchCipher: jest.Mock;
  let link: KeykeeperExpiresLink;

  const license = (renews?: string) =>
    templateFields({
      id: "t-1",
      name: "License",
      icon: "bwi-file-text",
      base: "note",
      fields: [{ label: "Renews", kind: "date", expires: true, value: renews }],
    });

  async function open(fields = license("2027-03-31")) {
    patchCipher = jest.fn();
    await TestBed.configureTestingModule({
      imports: [KeykeeperExpirationFieldComponent],
      providers: [
        KeykeeperExpiresLink,
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: CipherFormContainer,
          useValue: {
            patchCipher,
            config: { mode: "add", cipherType: CipherType.SecureNote, initialValues: { fields } },
            getInitialCipherView: () => null,
          },
        },
      ],
    }).compileComponents();
    link = TestBed.inject(KeykeeperExpiresLink);
    fixture = TestBed.createComponent(KeykeeperExpirationFieldComponent);
    fixture.detectChanges();
  }

  const expires = () =>
    fixture.nativeElement.querySelector('[data-testid="keykeeper-expires"]') as HTMLInputElement;
  const stored = () => {
    const cipher = new CipherView();
    cipher.fields = [];
    const fields = patchCipher.mock.lastCall[0](cipher).fields;
    return fields.find((f: { name: string }) => f.name === EXPIRES_FIELD_NAME)?.value ?? null;
  };

  it("starts a new item with its template's expiration date", async () => {
    await open();

    expect(expires().value).toBe("2027-03-31");
  });

  it("follows the expiration date field: a date sets it, none clears it, anything else leaves it", async () => {
    await open(license());
    expect(expires().value).toBe("");

    link.fieldChanged("2027-06-30");
    fixture.detectChanges();
    expect(expires().value).toBe("2027-06-30");
    expect(stored()).toBe("2027-06-30");

    link.fieldChanged("next spring");
    fixture.detectChanges();
    expect(expires().value).toBe("2027-06-30");

    link.fieldChanged("");
    fixture.detectChanges();
    expect(expires().value).toBe("");
    expect(stored()).toBeNull();
  });

  it("says when the person changes it, for the field to follow", async () => {
    await open(license());
    const said: string[] = [];
    link.fromExpires$.subscribe((date) => said.push(date));

    expires().value = "2027-09-30";
    expires().dispatchEvent(new Event("input"));

    expect(said).toEqual(["2027-09-30"]);
    expect(stored()).toBe("2027-09-30");
  });
});
