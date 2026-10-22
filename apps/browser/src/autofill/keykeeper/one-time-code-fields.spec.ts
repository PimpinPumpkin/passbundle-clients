import AutofillField from "../models/autofill-field";

import { isOneTimeCodeField } from "./one-time-code-fields";

/** A masked field with nothing said about it but what a test gives. */
function masked(described: Partial<AutofillField>): AutofillField {
  return {
    opid: "f",
    elementNumber: 0,
    viewable: true,
    type: "password",
    ...described,
  } as AutofillField;
}

describe("isOneTimeCodeField", () => {
  it.each([
    [
      "a label that asks for the code that was sent",
      { "label-tag": "Enter the 6-digit code we sent you" },
    ],
    ["a login code", { placeholder: "Login code" }],
    ["a sign-in code named in camel case", { htmlID: "signInCode" }],
    ["an OTP field by name", { htmlName: "otp" }],
    ["an MFA field by its aria label", { "label-aria": "MFA" }],
    ["a code described by its hint", { "aria-describedby": "Check your email for a code" }],
    ["a French code", { "label-tag": "Code de vérification" }],
  ])("is true for %s", (_, described) => {
    expect(isOneTimeCodeField(masked(described))).toBe(true);
  });

  it.each([
    ["a password", { "label-tag": "Password", htmlName: "password" }],
    ["a PIN", { "label-tag": "PIN", htmlName: "pin" }],
    ["a PIN code", { "label-tag": "PIN code" }],
    ["a passcode", { "label-tag": "Passcode" }],
    ["a password or a code", { "label-tag": "Password or one-time code" }],
    ["a German password", { "label-tag": "Passwort" }],
    ["a French password that mentions a code", { "label-tag": "Mot de passe ou code" }],
    [
      "a field the site marks as a password",
      { htmlName: "code", autoCompleteType: "current-password" },
    ],
    ["a field that says nothing", {}],
    ["a postal code", { "label-tag": "Postcode" }],
  ])("is false for %s", (_, described) => {
    expect(isOneTimeCodeField(masked(described))).toBe(false);
  });

  it("never reads the field's type, which is password for every masked field", () => {
    expect(isOneTimeCodeField(masked({ htmlName: "code" }))).toBe(true);
  });
});
