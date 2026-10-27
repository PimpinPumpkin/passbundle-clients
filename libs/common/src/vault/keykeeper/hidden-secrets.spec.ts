import { CardLinkedId, CipherType, FieldType, IdentityLinkedId, LoginLinkedId } from "../enums";
import { CipherData } from "../models/data/cipher.data";
import { Cipher } from "../models/domain/cipher";
import { CipherResponse } from "../models/response/cipher.response";
import { BankAccountView } from "../models/view/bank-account.view";
import { CardView } from "../models/view/card.view";
import { CipherView } from "../models/view/cipher.view";
import { Fido2CredentialView } from "../models/view/fido2-credential.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";
import { LoginUriView } from "../models/view/login-uri.view";
import { PassportView } from "../models/view/passport.view";
import { PasswordHistoryView } from "../models/view/password-history.view";
import { SshKeyView } from "../models/view/ssh-key.view";

import {
  HIDDEN_VALUE_MASK,
  isSecretCopyAction,
  isSecretCustomField,
  isSecretField,
  isSecretLinkedField,
  isSecretValue,
  ITEM_VALUES,
  mayCopy,
  mayShow,
  mayShowOrNew,
  maySeeSecrets,
  maySeeSecretsOrNew,
  PLAIN_VALUES,
  plainItem,
  shownSecret,
} from "./hidden-secrets";

describe("hidden secrets", () => {
  it("shows secrets only when the item says yes: missing is hidden", () => {
    expect(maySeeSecrets({ viewPassword: true })).toBe(true);
    expect(maySeeSecrets({ viewPassword: false })).toBe(false);
    expect(maySeeSecrets({})).toBe(false);
    expect(maySeeSecrets({ viewPassword: null })).toBe(false);
    expect(maySeeSecrets({ viewPassword: undefined })).toBe(false);
    expect(maySeeSecrets(null)).toBe(false);
    expect(maySeeSecrets(undefined)).toBe(false);
    expect(mayShow({}, "login.password")).toBe(false);
    expect(mayCopy({}, "password")).toBe(false);
    expect(shownSecret({}, "hunter2")).toBe(HIDDEN_VALUE_MASK);
  });

  it("hides the secrets of an item the server sent without saying", () => {
    const sent = (extra: object) =>
      new Cipher(
        new CipherData(
          new CipherResponse({
            Id: "id",
            Type: CipherType.Login,
            Name: "2.a|b|c",
            Login: {},
            ...extra,
          }),
        ),
      );
    expect(maySeeSecrets(sent({}))).toBe(false);
    expect(maySeeSecrets(new CipherView(sent({})))).toBe(false);
    expect(maySeeSecrets(sent({ ViewPassword: null }))).toBe(false);
    expect(maySeeSecrets(sent({ ViewPassword: false }))).toBe(false);
    expect(maySeeSecrets(sent({ ViewPassword: true }))).toBe(true);
    expect(maySeeSecrets(CipherView.fromJSON({ id: "id" } as never))).toBe(false);
  });

  it("in the editor, a new item (no original) is the person's own", () => {
    expect(maySeeSecretsOrNew(null)).toBe(true);
    expect(maySeeSecretsOrNew(undefined)).toBe(true);
    expect(maySeeSecretsOrNew({ viewPassword: true })).toBe(true);
    expect(maySeeSecretsOrNew({})).toBe(false);
    expect(maySeeSecretsOrNew({ viewPassword: false })).toBe(false);
    expect(mayShowOrNew(null, "identity.ssn")).toBe(true);
    expect(mayShowOrNew({}, "identity.ssn")).toBe(false);
    expect(mayShowOrNew({}, "identity.email")).toBe(true);
  });

  it("calls a linked field secret when it fills a secret, or a link it doesn't know", () => {
    const login = new CipherView();
    login.type = CipherType.Login;
    expect(isSecretLinkedField(login, LoginLinkedId.Password)).toBe(true);
    expect(isSecretLinkedField(login, LoginLinkedId.Username)).toBe(false);
    const card = new CipherView();
    card.type = CipherType.Card;
    expect(isSecretLinkedField(card, CardLinkedId.Number)).toBe(true);
    expect(isSecretLinkedField(card, CardLinkedId.Code)).toBe(true);
    expect(isSecretLinkedField(card, CardLinkedId.Brand)).toBe(false);
    const identity = new CipherView();
    identity.type = CipherType.Identity;
    for (const id of [
      IdentityLinkedId.Ssn,
      IdentityLinkedId.PassportNumber,
      IdentityLinkedId.LicenseNumber,
    ]) {
      expect(isSecretLinkedField(identity, id)).toBe(true);
    }
    expect(isSecretLinkedField(identity, IdentityLinkedId.Email)).toBe(false);
    expect(isSecretLinkedField(identity, IdentityLinkedId.FullName)).toBe(false);
    // A link the item's kind doesn't have, or none at all.
    expect(isSecretLinkedField(login, IdentityLinkedId.Email)).toBe(true);
    expect(isSecretLinkedField(login, null)).toBe(true);
    expect(isSecretLinkedField(null, LoginLinkedId.Username)).toBe(true);

    const linked = (linkedId: number) => ({ type: FieldType.Linked, linkedId }) as FieldView;
    expect(isSecretCustomField(login, linked(LoginLinkedId.Password))).toBe(true);
    expect(isSecretCustomField(login, linked(LoginLinkedId.Username))).toBe(false);
    expect(isSecretCustomField(login, { type: FieldType.Hidden })).toBe(true);
    expect(isSecretCustomField(login, { type: FieldType.Text })).toBe(false);
  });

  // The apps' rule (passbundle-apps, core/src/vault.rs, Item::is_secret).
  it("hides every value but the plain ones, as the apps do", () => {
    const secrets = Object.entries(ITEM_VALUES)
      .flatMap(([part, properties]) => properties.map((p) => `${part}.${p}`))
      .filter(isSecretValue)
      .sort();
    expect(secrets).toEqual(
      [
        "bankAccount.accountNumber",
        "bankAccount.iban",
        "bankAccount.pin",
        "bankAccount.swiftCode",
        "card.code",
        "card.number",
        "driversLicense.licenseNumber",
        "identity.licenseNumber",
        "identity.passportNumber",
        "identity.ssn",
        "login.password",
        "login.totp",
        "passport.nationalIdentificationNumber",
        "passport.passportNumber",
        "sshKey.privateKey",
      ].sort(),
    );
  });

  it("calls a value no one has listed yet a secret", () => {
    expect(isSecretValue("bankAccount.cvv")).toBe(true);
    expect(isSecretValue("someNewKind.anything")).toBe(true);
    // Every plain value is one an item has, or one the views name.
    for (const key of PLAIN_VALUES) {
      expect(isSecretValue(key)).toBe(false);
    }
  });

  it("hides hidden custom fields and any kind not known to be plain", () => {
    expect(isSecretField(FieldType.Hidden)).toBe(true);
    expect(isSecretField(FieldType.Text)).toBe(false);
    expect(isSecretField(FieldType.Boolean)).toBe(false);
    expect(isSecretField(FieldType.Linked)).toBe(false);
    expect(isSecretField(99 as FieldType)).toBe(true);
    expect(isSecretField(undefined)).toBe(true);
  });

  it("refuses copying a secret without see passwords, and allows the plain ones", () => {
    const hidden = { viewPassword: false };
    for (const action of [
      "password",
      "totp",
      "cardNumber",
      "securityCode",
      "privateKey",
      "hiddenField",
      "accountNumber",
      "pin",
      "iban",
      "swiftCode",
      "licenseNumber",
      "passportNumber",
      "nationalIdentificationNumber",
      "someFutureAction",
    ]) {
      expect(isSecretCopyAction(action)).toBe(true);
      expect(mayCopy(hidden, action)).toBe(false);
      expect(mayCopy({ viewPassword: true }, action)).toBe(true);
    }
    for (const action of ["username", "email", "phone", "address", "publicKey", "routingNumber"]) {
      expect(mayCopy(hidden, action)).toBe(true);
    }
  });

  it("shows a plain value to anyone, and a secret only with see passwords", () => {
    expect(mayShow({ viewPassword: false }, "identity.email")).toBe(true);
    expect(mayShow({ viewPassword: false }, "identity.ssn")).toBe(false);
    expect(mayShow({ viewPassword: true }, "identity.ssn")).toBe(true);
  });

  it("shows the mask in place of a hidden value, and nothing for an empty one", () => {
    expect(shownSecret({ viewPassword: false }, "hunter2")).toBe(HIDDEN_VALUE_MASK);
    expect(shownSecret({ viewPassword: true }, "hunter2")).toBe("hunter2");
    expect(shownSecret({ viewPassword: false }, "")).toBe("");
    expect(shownSecret({ viewPassword: false }, null)).toBe("");
  });

  it("builds a copy up from the plain values only", () => {
    const item = new CipherView();
    item.id = "source-id";
    item.type = CipherType.Login;
    item.organizationId = "org-id";
    item.folderId = "folder-id";
    item.collectionIds = ["everyone"];
    item.name = "Clinic Wi-Fi";
    item.notes = "Front desk";
    item.viewPassword = false;
    item.login.username = "frontdesk";
    item.login.password = "hunter2";
    item.login.totp = "JBSWY3DPEHPK3PXP";
    item.login.uris = [Object.assign(new LoginUriView(), { uri: "https://clinic.test" })];
    item.login.fido2Credentials = [new Fido2CredentialView()];
    item.passwordHistory = [Object.assign(new PasswordHistoryView(), { password: "old" })];
    item.fields = [
      Object.assign(new FieldView(), { name: "PIN", value: "1", type: FieldType.Hidden }),
      Object.assign(new FieldView(), { name: "Site", value: "HQ", type: FieldType.Text }),
      Object.assign(new FieldView(), {
        name: "Secret link",
        type: FieldType.Linked,
        linkedId: LoginLinkedId.Password,
      }),
      Object.assign(new FieldView(), {
        name: "User link",
        type: FieldType.Linked,
        linkedId: LoginLinkedId.Username,
      }),
    ];

    const copy = plainItem(item);

    expect(copy).not.toBe(item);
    expect(copy.id).toBe("");
    expect(copy.key).toBeUndefined();
    expect(copy.name).toBe("Clinic Wi-Fi");
    expect(copy.notes).toBe("Front desk");
    expect(copy.type).toBe(CipherType.Login);
    expect(copy.organizationId).toBe("org-id");
    expect(copy.folderId).toBe("folder-id");
    expect(copy.collectionIds).toEqual(["everyone"]);
    expect(copy.viewPassword).toBe(false);
    expect(copy.login.username).toBe("frontdesk");
    expect(copy.login.password).toBeUndefined();
    expect(copy.login.totp).toBeUndefined();
    expect(copy.login.uris.map((u) => u.uri)).toEqual(["https://clinic.test"]);
    expect(copy.login.fido2Credentials ?? []).toEqual([]);
    expect(copy.passwordHistory).toEqual([]);
    expect(copy.attachments).toEqual([]);
    expect(copy.fields.map((f) => f.name)).toEqual(["Site", "User link"]);
    // The source is untouched.
    expect(item.login.password).toBe("hunter2");
  });

  it("leaves every secret of every kind out of a copy, and keeps the plain ones", () => {
    const card = new CipherView();
    card.type = CipherType.Card;
    card.viewPassword = false;
    card.card = Object.assign(new CardView(), { cardholderName: "Ana", code: "987" });
    card.card.number = "4242424242424242";
    card.card.brand = "Visa";
    const cardCopy = plainItem(card);
    expect(cardCopy.card.number).toBeUndefined();
    expect(cardCopy.card.code).toBeUndefined();
    expect(cardCopy.card.cardholderName).toBe("Ana");
    expect(cardCopy.card.brand).toBe("Visa");

    const identity = new CipherView();
    identity.type = CipherType.Identity;
    identity.identity = Object.assign(new IdentityView(), {
      ssn: "078-05-1120",
      passportNumber: "P1",
      licenseNumber: "D1",
      email: "a@b.test",
    });
    const identityCopy = plainItem(identity);
    expect(identityCopy.identity.ssn).toBeUndefined();
    expect(identityCopy.identity.passportNumber).toBeUndefined();
    expect(identityCopy.identity.licenseNumber).toBeUndefined();
    expect(identityCopy.identity.email).toBe("a@b.test");

    const bank = new CipherView();
    bank.type = CipherType.BankAccount;
    bank.bankAccount = Object.assign(new BankAccountView(), {
      pin: "4421",
      accountNumber: "9988",
      iban: "GB33",
      swiftCode: "BOFA",
      routingNumber: "021",
      bankName: "First",
    });
    const bankCopy = plainItem(bank);
    for (const secret of ["pin", "accountNumber", "iban", "swiftCode"] as const) {
      expect(bankCopy.bankAccount[secret]).toBeUndefined();
    }
    expect(bankCopy.bankAccount.routingNumber).toBe("021");
    expect(bankCopy.bankAccount.bankName).toBe("First");

    const passport = new CipherView();
    passport.type = CipherType.Passport;
    passport.passport = Object.assign(new PassportView(), {
      passportNumber: "X1",
      nationalIdentificationNumber: "N1",
      surname: "Reyes",
    });
    const passportCopy = plainItem(passport);
    expect(passportCopy.passport.passportNumber).toBeUndefined();
    expect(passportCopy.passport.nationalIdentificationNumber).toBeUndefined();
    expect(passportCopy.passport.surname).toBe("Reyes");

    const ssh = new CipherView();
    ssh.type = CipherType.SshKey;
    ssh.sshKey = Object.assign(new SshKeyView(), {
      privateKey: "PRIVATE",
      publicKey: "ssh-ed25519 AAAA",
    });
    const sshCopy = plainItem(ssh);
    expect(sshCopy.sshKey.privateKey).toBeFalsy();
    expect(sshCopy.sshKey.publicKey).toBe("ssh-ed25519 AAAA");
  });

  it("leaves out a value added to items later, until someone lists it as plain", () => {
    const item = new CipherView();
    item.type = CipherType.BankAccount;
    item.bankAccount = Object.assign(new BankAccountView(), { bankName: "First" });
    Object.assign(item.bankAccount, { recoveryCode: "R-1" });
    Object.assign(item.login, { someNewSecret: "S-1" });
    Object.assign(item, { someNewTopLevelSecret: "T-1" });

    const copy = plainItem(item);

    expect(copy.bankAccount.bankName).toBe("First");
    expect(JSON.stringify(copy)).not.toMatch(/R-1|S-1|T-1/);
  });
});
