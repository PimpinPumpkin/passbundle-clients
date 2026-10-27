import { FieldType } from "../enums";
import { BankAccountView } from "../models/view/bank-account.view";
import { CardView } from "../models/view/card.view";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";
import { PassportView } from "../models/view/passport.view";
import { SshKeyView } from "../models/view/ssh-key.view";

import {
  clearHiddenSecrets,
  HIDDEN_VALUE_MASK,
  isSecretCopyAction,
  isSecretField,
  isSecretValue,
  ITEM_VALUES,
  mayCopy,
  mayShow,
  maySeeSecrets,
  PLAIN_VALUES,
  shownSecret,
} from "./hidden-secrets";

describe("hidden secrets", () => {
  it("hides secrets only when the item says the person can't see them", () => {
    expect(maySeeSecrets({ viewPassword: true })).toBe(true);
    expect(maySeeSecrets({})).toBe(true);
    expect(maySeeSecrets(null)).toBe(true);
    expect(maySeeSecrets({ viewPassword: false })).toBe(false);
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

  it("takes every covered secret out of a copy, and keeps the rest", () => {
    const item = new CipherView();
    item.login.username = "frontdesk";
    item.login.password = "hunter2";
    item.login.totp = "JBSWY3DPEHPK3PXP";
    item.card = new CardView();
    item.card.cardholderName = "Ana";
    item.card.number = "4242424242424242";
    item.card.code = "987";
    item.sshKey = new SshKeyView();
    item.sshKey.privateKey = "PRIVATE";
    item.sshKey.publicKey = "ssh-ed25519 AAAA";
    const hidden = Object.assign(new FieldView(), {
      name: "PIN",
      value: "1",
      type: FieldType.Hidden,
    });
    const text = Object.assign(new FieldView(), {
      name: "Site",
      value: "HQ",
      type: FieldType.Text,
    });
    item.fields = [hidden, text];

    item.identity = Object.assign(new IdentityView(), { ssn: "123-45-6789", email: "a@b.test" });
    item.bankAccount = Object.assign(new BankAccountView(), { pin: "4421", bankName: "First" });
    item.passport = Object.assign(new PassportView(), { passportNumber: "X1", surname: "Reyes" });

    clearHiddenSecrets(item);

    expect(item.identity.ssn).toBeUndefined();
    expect(item.identity.email).toBe("a@b.test");
    expect(item.bankAccount.pin).toBeUndefined();
    expect(item.bankAccount.bankName).toBe("First");
    expect(item.passport.passportNumber).toBeUndefined();
    expect(item.passport.surname).toBe("Reyes");
    expect(item.login.username).toBe("frontdesk");
    expect(item.login.password).toBeUndefined();
    expect(item.login.totp).toBeUndefined();
    expect(item.card.number).toBeUndefined();
    expect(item.card.code).toBeUndefined();
    expect(item.card.cardholderName).toBe("Ana");
    expect(item.sshKey.privateKey).toBe("");
    expect(item.sshKey.publicKey).toBe("ssh-ed25519 AAAA");
    expect(item.fields.map((f) => f.value)).toEqual([undefined, "HQ"]);
    expect(item.passwordHistory).toEqual([]);
  });
});
