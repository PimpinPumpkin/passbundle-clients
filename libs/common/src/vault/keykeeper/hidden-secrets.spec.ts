import { FieldType } from "../enums";
import { CardView } from "../models/view/card.view";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { SshKeyView } from "../models/view/ssh-key.view";

import {
  clearHiddenSecrets,
  HIDDEN_SECRET_ACTIONS,
  HIDDEN_VALUE_MASK,
  mayCopy,
  maySeeSecrets,
  shownSecret,
} from "./hidden-secrets";

describe("hidden secrets", () => {
  it("hides secrets only when the item says the person can't see them", () => {
    expect(maySeeSecrets({ viewPassword: true })).toBe(true);
    expect(maySeeSecrets({})).toBe(true);
    expect(maySeeSecrets(null)).toBe(true);
    expect(maySeeSecrets({ viewPassword: false })).toBe(false);
  });

  it("covers the password, one-time codes, a card's number and code, SSH private keys, and hidden fields", () => {
    expect([...HIDDEN_SECRET_ACTIONS].sort()).toEqual(
      ["cardNumber", "hiddenField", "password", "privateKey", "securityCode", "totp"].sort(),
    );
  });

  it("refuses copying a secret without see passwords, and allows the rest", () => {
    const hidden = { viewPassword: false };
    for (const action of HIDDEN_SECRET_ACTIONS) {
      expect(mayCopy(hidden, action)).toBe(false);
      expect(mayCopy({ viewPassword: true }, action)).toBe(true);
    }
    expect(mayCopy(hidden, "username")).toBe(true);
    expect(mayCopy(hidden, "publicKey")).toBe(true);
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

    clearHiddenSecrets(item);

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
