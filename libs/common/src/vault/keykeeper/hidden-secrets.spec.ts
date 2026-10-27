import {
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
});
