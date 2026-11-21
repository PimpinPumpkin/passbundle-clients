import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import AutofillService from "../services/autofill.service";
import { InlineMenuFieldQualificationService } from "../services/inline-menu-field-qualification.service";
import { createAutofillFormMock } from "../spec/autofill-mocks";

import {
  isPinBesidePassword,
  isPinField,
  pinAttributes,
  pinsBesidePasswords,
  withoutPinsBesidePasswords,
} from "./pin-fields";

/** A field as page details describe it, with nothing on it that says what it is. */
function field(opid: string, custom: Partial<AutofillField> = {}): AutofillField {
  const id = custom.opid ?? opid;
  return {
    opid: id,
    elementNumber: Number(id.replace(/\D/g, "")) || 0,
    viewable: true,
    htmlID: null,
    htmlName: null,
    htmlClass: null,
    tabindex: null,
    title: null,
    "label-left": "",
    "label-right": "",
    "label-top": null,
    "label-tag": "",
    "label-aria": null,
    placeholder: null,
    type: "text",
    value: "",
    disabled: false,
    readonly: false,
    form: "__form__0",
    autoCompleteType: null,
    maxLength: 999,
    tagName: "input",
    ...custom,
  };
}

/** A page with one form, as the content script collects it. */
const page = (fields: AutofillField[]): AutofillPageDetails => ({
  title: "Sign in",
  url: "https://bank.example.test/login",
  documentUrl: "https://bank.example.test/login",
  forms: { __form__0: createAutofillFormMock({ opid: "__form__0", htmlID: "", htmlName: "" }) },
  fields,
  collectedTimestamp: 0,
});

// pin-beside-password.html in the autofill corpus: a customer ID, the
// password, and a four-digit security PIN, both masked, in one form. The
// password field has the PIN's label after it, as the page collects it.
const customer = () =>
  field("__0", { htmlID: "customer", htmlName: "customer", "label-tag": "Customer ID" });
const password = (custom: Partial<AutofillField> = {}) =>
  field("__1", {
    type: "password",
    htmlID: "password",
    htmlName: "password",
    "label-tag": "Password",
    "label-left": "Password",
    "label-right": "Security PIN",
    ...custom,
  });
const securityPin = (custom: Partial<AutofillField> = {}) =>
  field("__2", {
    type: "password",
    htmlID: "pin",
    htmlName: "pin",
    "label-tag": "Security PIN",
    "label-left": "Security PIN",
    inputMode: "numeric",
    maxLength: 4,
    ...custom,
  });
const corpusPage = () => page([customer(), password(), securityPin()]);

describe("Keykeeper: a PIN beside the password", () => {
  let qualification: InlineMenuFieldQualificationService;
  const fieldOf = (details: AutofillPageDetails, opid: string) =>
    details.fields.find((f) => f.opid === opid)!;
  /** Whether a field gets the logins' menu, as a sign-in's field. */
  const forLogin = (details: AutofillPageDetails, opid: string) =>
    qualification.isFieldForLoginForm(fieldOf(details, opid), details);
  /** Whether a field gets the menu for a new account. */
  const forSignUp = (details: AutofillPageDetails, opid: string) =>
    qualification.isFieldForAccountCreationForm(fieldOf(details, opid), details);
  /** The fields a login's password goes into. */
  const passwordFields = (details: AutofillPageDetails) =>
    AutofillService.loadPasswordFields(details, false, false, false, false).map((f) => f.opid);

  beforeEach(() => {
    qualification = new InlineMenuFieldQualificationService();
  });

  describe("the corpus page", () => {
    it("is a sign-in: the customer ID and the password get the logins' menu, the PIN doesn't", () => {
      const details = corpusPage();
      expect(forLogin(details, "__0")).toBe(true);
      expect(forLogin(details, "__1")).toBe(true);
      expect(forLogin(details, "__2")).toBe(false);
      expect(forSignUp(details, "__2")).toBe(false);
    });

    it("puts the password into the password field only", () => {
      expect(passwordFields(corpusPage())).toEqual(["__1"]);
    });

    it("reads as a sign-up without the PIN rule, as upstream has it", () => {
      // The same page with a PIN box that says nothing about itself.
      const details = page([
        customer(),
        password({ "label-right": "" }),
        securityPin({
          htmlID: "f3",
          htmlName: "f3",
          "label-tag": "",
          "label-left": "",
          inputMode: undefined,
          maxLength: 999,
        }),
      ]);
      expect(forLogin(details, "__0")).toBe(false);
      expect(forLogin(details, "__1")).toBe(false);
      expect(passwordFields(details)).toEqual(["__1", "__2"]);
    });
  });

  describe("what marks a PIN, each on its own", () => {
    // Beside the password, with nothing else on it that says what it is.
    const pinBox = (custom: Partial<AutofillField>) =>
      securityPin({
        htmlID: "f3",
        htmlName: "f3",
        "label-tag": "",
        "label-left": "",
        inputMode: undefined,
        maxLength: 999,
        ...custom,
      });
    const signals: [string, Partial<AutofillField>][] = [
      ['autocomplete="one-time-code"', { autoCompleteType: "one-time-code" }],
      ["an autocomplete hint that names a PIN", { autoCompleteType: "pin" }],
      ['inputmode="numeric"', { inputMode: "numeric" }],
      ["a pattern of digits", { pattern: "\\d{4}" }],
      ["another pattern of digits", { pattern: "[0-9]*" }],
      ["an anchored pattern of digits", { pattern: "^[0-9]{4,6}$" }],
      ['maxlength="8"', { maxLength: 8 }],
      ['maxlength="4"', { maxLength: 4 }],
      ['id="pin"', { htmlID: "pin" }],
      ['name="pin_code"', { htmlName: "pin_code" }],
      ['name="userPIN"', { htmlName: "userPIN" }],
      ['a label "Security PIN"', { "label-tag": "Security PIN" }],
      ['a label "Passcode"', { "label-tag": "Passcode" }],
      ['a label "Security code"', { "label-tag": "Security code" }],
      ['an aria label "PIN"', { "label-aria": "PIN" }],
      ['a placeholder "4-digit PIN"', { placeholder: "4-digit PIN" }],
      ['a title "Your PIN"', { title: "Your PIN" }],
      ['a German label "Geheimzahl"', { "label-tag": "Geheimzahl" }],
      ['a German label "PIN-Nummer"', { "label-tag": "PIN-Nummer" }],
      ['a German label "Sicherheitscode"', { "label-tag": "Sicherheitscode" }],
    ];

    it.each(signals)("%s", (_, custom) => {
      const pin = pinBox(custom);
      expect(isPinField(pin)).toBe(true);
      const details = page([customer(), password({ "label-right": "" }), pin]);
      expect(isPinBesidePassword(pin, details)).toBe(true);
      expect(forLogin(details, "__0")).toBe(true);
      expect(forLogin(details, "__1")).toBe(true);
      expect(forLogin(details, "__2")).toBe(false);
      expect(passwordFields(details)).toEqual(["__1"]);
    });

    it("is none of them for a masked field that says nothing, or a long maxlength", () => {
      expect(isPinField(pinBox({}))).toBe(false);
      expect(isPinField(pinBox({ maxLength: 9 }))).toBe(false);
      expect(isPinField(pinBox({ maxLength: 0 }))).toBe(false);
      expect(isPinField(pinBox({ inputMode: "text" }))).toBe(false);
      expect(isPinField(pinBox({ pattern: "[A-Za-z0-9]{8,}" }))).toBe(false);
      expect(isPinField(pinBox({ htmlName: "spinner" }))).toBe(false);
    });

    it("is never a field the page shows as text", () => {
      expect(isPinField(field("__3", { "label-tag": "PIN", inputMode: "numeric" }))).toBe(false);
    });

    it("gives way to a password's autocomplete hint, and to words that name a password", () => {
      expect(isPinField(pinBox({ autoCompleteType: "current-password", htmlID: "pin" }))).toBe(
        false,
      );
      expect(isPinField(pinBox({ autoCompleteType: "new-password", maxLength: 6 }))).toBe(false);
      expect(isPinField(pinBox({ "label-tag": "Password", maxLength: 8 }))).toBe(false);
      expect(isPinField(pinBox({ "label-tag": "Kennwort", inputMode: "numeric" }))).toBe(false);
      expect(isPinField(pinBox({ htmlName: "pass2", pattern: "\\d*" }))).toBe(false);
      expect(isPinField(pinBox({ "label-tag": "Bestätigung", maxLength: 8 }))).toBe(false);
      // A PIN's own name wins over the words around it.
      expect(isPinField(pinBox({ "label-tag": "Confirm PIN", htmlID: "password2" }))).toBe(true);
    });

    it("reads only what the field says about itself, never the next field's label", () => {
      // "Security PIN" is the text after the password field, which is the PIN's label.
      expect(isPinField(password())).toBe(false);
      expect(isPinField(pinBox({ "label-left": "PIN", "label-right": "PIN" }))).toBe(false);
    });
  });

  describe("only beside a password", () => {
    it("leaves a PIN that's the only masked field as the password, as upstream has it", () => {
      // email-pin.html: a sign-in with an email and a PIN.
      const pin = field("__1", {
        type: "password",
        htmlID: "pin",
        htmlName: "pin",
        "label-tag": "PIN",
        inputMode: "numeric",
      });
      const details = page([field("__0", { type: "email", htmlID: "email" }), pin]);
      expect(isPinField(pin)).toBe(true);
      expect(isPinBesidePassword(pin, details)).toBe(false);
      expect(withoutPinsBesidePasswords(details)).toBe(details);
      expect(forLogin(details, "__0")).toBe(true);
      expect(forLogin(details, "__1")).toBe(true);
      expect(passwordFields(details)).toEqual(["__1"]);
    });

    it("leaves masked fields that are all PINs as they are", () => {
      const details = page([
        customer(),
        securityPin({ opid: "__1", htmlID: "pin1" }),
        securityPin({ opid: "__2", htmlID: "pin2", "label-tag": "Confirm PIN" }),
      ]);
      expect(pinsBesidePasswords(details.fields).size).toBe(0);
      expect(passwordFields(details)).toEqual(["__1", "__2"]);
    });

    it("needs the password in the same form, and one people can see", () => {
      const elsewhere = page([customer(), password(), securityPin({ form: "__form__1" })]);
      expect(pinsBesidePasswords(elsewhere.fields).size).toBe(0);

      const hiddenPassword = page([customer(), password({ viewable: false }), securityPin()]);
      expect(pinsBesidePasswords(hiddenPassword.fields).size).toBe(0);
    });

    it("counts fields without a form as the page's", () => {
      const details = page([
        customer(),
        password({ form: null }),
        securityPin({ form: undefined }),
      ]);
      expect([...pinsBesidePasswords(details.fields)].map((f) => f.opid)).toEqual(["__2"]);
    });

    it("hands back the page without the PINs, and otherwise the same fields", () => {
      const details = corpusPage();
      const read = withoutPinsBesidePasswords(details);
      expect(read.fields.map((f) => f.opid)).toEqual(["__0", "__1"]);
      expect(read.fields[0]).toBe(details.fields[0]);
      expect(details.fields).toHaveLength(3);
    });
  });

  // Each as upstream reads it, which the PIN rule leaves alone: the
  // confirmation is a second password, gets the new account's menu, and gets
  // a password when one fills (a PIN wouldn't).
  describe("sign-up pages stay sign-up pages", () => {
    const email = () =>
      field("__0", { type: "email", htmlID: "email", htmlName: "email", "label-tag": "Email" });
    const signUp = (confirm: Partial<AutofillField>, first: Partial<AutofillField> = {}) =>
      page([
        email(),
        field("__1", { type: "password", htmlID: "pw1", "label-tag": "Password", ...first }),
        field("__2", { type: "password", htmlID: "pw2", ...confirm }),
      ]);
    const expectSignUp = (details: AutofillPageDetails, fillNewPassword = false) => {
      expect(details.fields.filter(isPinField)).toEqual([]);
      expect(withoutPinsBesidePasswords(details)).toBe(details);
      expect(
        AutofillService.loadPasswordFields(details, false, false, false, fillNewPassword).map(
          (f) => f.opid,
        ),
      ).toEqual(["__1", "__2"]);
    };

    it("a new password and its confirmation marked new-password", () => {
      const details = signUp(
        { "label-tag": "Confirm password", autoCompleteType: "new-password", maxLength: 8 },
        { "label-tag": "New password", autoCompleteType: "new-password" },
      );
      expectSignUp(details, true);
      expect(forSignUp(details, "__1")).toBe(true);
      expect(forSignUp(details, "__2")).toBe(true);
    });

    it('two plain password fields labeled "Password" and "Confirm password"', () => {
      const details = signUp({ "label-tag": "Confirm password" });
      expectSignUp(details);
      expect(forSignUp(details, "__2")).toBe(true);
    });

    it('a confirmation with maxlength="6", labeled "Confirm password"', () => {
      const details = signUp({ "label-tag": "Confirm password", maxLength: 6 });
      expectSignUp(details);
      expect(forSignUp(details, "__2")).toBe(true);
    });

    it('a short, numeric confirmation that only says "Type it again"', () => {
      // As the corpus's sign-up beside a sign-in has it: no field gets the logins' menu.
      const details = signUp(
        { "label-tag": "Type it again", inputMode: "numeric", maxLength: 8 },
        { "label-tag": "Choose a password" },
      );
      expectSignUp(details);
      expect(forLogin(details, "__0")).toBe(false);
      expect(forLogin(details, "__1")).toBe(false);
      expect(forLogin(details, "__2")).toBe(false);
    });

    it("a sign-up that also asks for a PIN: the PIN is left out, the two passwords stay", () => {
      const details = page([
        ...signUp({ "label-tag": "Confirm password" }).fields,
        securityPin({ opid: "__3", "label-tag": "Choose a PIN" }),
      ]);
      expect(forSignUp(details, "__2")).toBe(true);
      expect(forSignUp(details, "__3")).toBe(false);
      expect(
        AutofillService.loadPasswordFields(details, false, false, false, true).map((f) => f.opid),
      ).toEqual(["__1", "__2"]);
    });
  });

  describe("a sign-in form's other text field, known by its label", () => {
    it("still gets the logins' menu beside a password and a PIN", () => {
      // A bank's sign-in: a customer number, the username, the password, and a PIN.
      const details = page([
        field("__0", { htmlID: "custno", "label-tag": "Customer number" }),
        field("__1", { htmlID: "username", "label-tag": "Username" }),
        password({ opid: "__2", autoCompleteType: "current-password" }),
        securityPin({ opid: "__3" }),
      ]);
      expect(qualification.isLabelFieldForLoginForm(details.fields[0], details)).toBe(true);
    });
  });

  describe("pinAttributes", () => {
    it("reads inputmode and pattern from the element, only when it has them", () => {
      document.body.innerHTML = `
        <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" />
        <input id="plain" type="password" />
      `;
      expect(pinAttributes(document.getElementById("pin")!)).toEqual({
        inputMode: "numeric",
        pattern: "[0-9]*",
      });
      expect(pinAttributes(document.getElementById("plain")!)).toEqual({});
    });
  });
});
