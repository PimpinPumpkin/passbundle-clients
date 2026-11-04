import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import AutofillScript from "../models/autofill-script";
import AutofillService from "../services/autofill.service";

import {
  applyFillRules,
  fieldMatches,
  FillRule,
  FillRuleOptions,
  FILL_RULE_FIELD_NAME,
  FillSource,
  fingerprintField,
  readFillRules,
  staticValueFor,
  upsertFillRule,
  visibleCustomFields,
} from "./fill-rules";

function pageField(overrides: Partial<AutofillField>): AutofillField {
  return {
    opid: "__0",
    elementNumber: 0,
    viewable: true,
    htmlID: null,
    htmlName: null,
    htmlClass: null,
    tabindex: null,
    title: null,
    ...overrides,
  } as AutofillField;
}

function customField(name: string, value: string, type: FieldType = FieldType.Text) {
  const field = new FieldView();
  field.name = name;
  field.value = value;
  field.type = type;
  return field;
}

function loginItem(fields: FieldView[] = []): CipherView {
  const cipher = new CipherView();
  cipher.type = CipherType.Login;
  cipher.login = new LoginView();
  cipher.login.username = "alice";
  cipher.login.password = "correct-password";
  cipher.fields = fields;
  return cipher;
}

const HOST = "bank.example.com";
const PAGE = `https://${HOST}/login`;

const rule = (field: FillRule["field"], fill: FillSource, host: string | null = HOST): FillRule =>
  host == null ? { v: 1, field, fill } : { v: 1, host, field, fill };

function fill(fillScript: AutofillScript, field: AutofillField, value: string) {
  fillScript.script.push(["fill_by_opid", field.opid, value]);
}

/** A fill the person started, as from the popup: upstream's limits for page load are off. */
const STARTED: FillRuleOptions = {
  userStarted: true,
  onlyEmptyFields: false,
  skipUsernameOnlyFill: false,
  allowTotp: true,
  excluded: AutofillService.isExcludedFromFillRules,
};
/** Autofill on page load, with upstream's limits for it. */
const PAGE_LOAD: FillRuleOptions = {
  userStarted: false,
  onlyEmptyFields: true,
  skipUsernameOnlyFill: true,
  allowTotp: false,
  excluded: AutofillService.isExcludedFromFillRules,
};

describe("Keykeeper fill rules", () => {
  describe("fingerprintField", () => {
    it("uses the id, the name, and the visible label, normalized", () => {
      const field = pageField({
        htmlID: "custno",
        htmlName: "customer",
        "label-tag": "  Customer\n number ",
      });

      expect(fingerprintField(field)).toEqual({
        id: "custno",
        name: "customer",
        label: "customer number",
      });
    });

    it("falls back to the aria label and then the placeholder", () => {
      expect(fingerprintField(pageField({ "label-aria": "PIN" }))).toEqual({ label: "pin" });
      expect(fingerprintField(pageField({ placeholder: "Member ID" }))).toEqual({
        label: "member id",
      });
    });
  });

  describe("fieldMatches", () => {
    it("lets the id decide whenever the rule has one", () => {
      expect(
        fieldMatches(
          { id: "custno", name: "customer", label: "customer number" },
          pageField({ htmlName: "customer", "label-tag": "Customer number" }),
        ),
      ).toBe(false);
      expect(fieldMatches({ name: "pin", label: "pin" }, pageField({ "label-tag": "PIN" }))).toBe(
        false,
      );
    });

    it("lets the id decide when both sides have one", () => {
      const fingerprint = { id: "custno", label: "customer number" };

      expect(fieldMatches(fingerprint, pageField({ htmlID: "custno" }))).toBe(true);
      expect(
        fieldMatches(fingerprint, pageField({ htmlID: "other", "label-tag": "Customer number" })),
      ).toBe(false);
    });

    it("uses the name when there is no id, then the label", () => {
      expect(fieldMatches({ name: "pin" }, pageField({ htmlName: "pin" }))).toBe(true);
      expect(fieldMatches({ name: "pin" }, pageField({ htmlName: "otp" }))).toBe(false);
      expect(fieldMatches({ label: "member id" }, pageField({ "label-tag": "Member ID" }))).toBe(
        true,
      );
    });

    it("never matches on an empty fingerprint", () => {
      expect(fieldMatches({}, pageField({ htmlID: "x" }))).toBe(false);
    });
  });

  describe("reading and writing rules", () => {
    it("reads only valid rules and ignores everything else", () => {
      const cipher = loginItem([
        customField("Customer ID", "C-12345"),
        customField(
          FILL_RULE_FIELD_NAME,
          JSON.stringify(rule({ id: "custno" }, { from: "field", name: "Customer ID" })),
          FieldType.Hidden,
        ),
        customField(FILL_RULE_FIELD_NAME, "not json", FieldType.Hidden),
        customField(
          FILL_RULE_FIELD_NAME,
          JSON.stringify({ v: 2, field: {}, fill: { from: "never" } }),
          FieldType.Hidden,
        ),
        customField(
          FILL_RULE_FIELD_NAME,
          JSON.stringify({ v: 1, field: {}, fill: { from: "everything" } }),
          FieldType.Hidden,
        ),
      ]);

      expect(readFillRules(cipher)).toEqual([
        rule({ id: "custno" }, { from: "field", name: "Customer ID" }),
      ]);
    });

    it("keeps rules for the same field on different hosts apart", () => {
      const cipher = loginItem();
      upsertFillRule(cipher, rule({ id: "pin" }, { from: "password" }));
      upsertFillRule(cipher, rule({ id: "pin" }, { from: "never" }, "other.example.com"));

      expect(readFillRules(cipher)).toEqual([
        rule({ id: "pin" }, { from: "password" }),
        rule({ id: "pin" }, { from: "never" }, "other.example.com"),
      ]);
    });

    it("stores a rule as a hidden field and replaces an older rule for the same field", () => {
      const cipher = loginItem([customField("Customer ID", "C-12345")]);

      upsertFillRule(cipher, rule({ id: "pin" }, { from: "password" }));
      upsertFillRule(cipher, rule({ id: "custno" }, { from: "field", name: "Customer ID" }));
      upsertFillRule(cipher, rule({ id: "pin" }, { from: "never" }));

      expect(readFillRules(cipher)).toEqual([
        rule({ id: "custno" }, { from: "field", name: "Customer ID" }),
        rule({ id: "pin" }, { from: "never" }),
      ]);
      expect(
        cipher.fields
          .filter((f) => f.name === FILL_RULE_FIELD_NAME)
          .every((f) => f.type === FieldType.Hidden),
      ).toBe(true);
      expect(visibleCustomFields(cipher).map((f) => f.name)).toEqual(["Customer ID"]);
    });
  });

  describe("applyFillRules", () => {
    const valueFor = (cipher: CipherView) => async (source: FillSource) =>
      source.from === "totp" ? "123456" : staticValueFor(cipher, source);

    it("fills a field from a custom field and claims it", async () => {
      const cipher = loginItem([customField("Customer ID", "C-12345")]);
      upsertFillRule(cipher, rule({ id: "custno" }, { from: "field", name: "Customer ID" }));
      const pageDetails = {
        url: PAGE,
        fields: [pageField({ opid: "__1", htmlID: "custno" })],
      } as AutofillPageDetails;
      const fillScript = new AutofillScript();
      const filledFields: { [opid: string]: AutofillField } = {};

      await applyFillRules(cipher, pageDetails, fillScript, filledFields, valueFor(cipher), fill, STARTED);

      expect(fillScript.script).toEqual([["fill_by_opid", "__1", "C-12345"]]);
      expect(Object.keys(filledFields)).toEqual(["__1"]);
    });

    it("claims a never-fill field without filling it, so nothing else fills it", async () => {
      const cipher = loginItem();
      upsertFillRule(cipher, rule({ id: "pin" }, { from: "never" }));
      const pageDetails = {
        url: PAGE,
        fields: [pageField({ opid: "__2", htmlID: "pin", type: "password" })],
      } as AutofillPageDetails;
      const fillScript = new AutofillScript();
      const filledFields: { [opid: string]: AutofillField } = {};

      const neverFill = await applyFillRules(
        cipher,
        pageDetails,
        fillScript,
        filledFields,
        valueFor(cipher),
        fill,
        STARTED,
      );

      expect(fillScript.script).toEqual([]);
      expect(Object.keys(filledFields)).toEqual(["__2"]);
      expect([...neverFill]).toEqual(["__2"]);
    });

    it("fills the verification code when the rule asks for it", async () => {
      const cipher = loginItem();
      upsertFillRule(cipher, rule({ name: "otp" }, { from: "totp" }));
      const pageDetails = {
        url: PAGE,
        fields: [pageField({ opid: "__3", htmlName: "otp" })],
      } as AutofillPageDetails;
      const fillScript = new AutofillScript();

      await applyFillRules(cipher, pageDetails, fillScript, {}, valueFor(cipher), fill, STARTED);

      expect(fillScript.script).toEqual([["fill_by_opid", "__3", "123456"]]);
    });

    it("skips fields that are already filled and rules whose value is gone", async () => {
      const cipher = loginItem();
      upsertFillRule(cipher, rule({ id: "a" }, { from: "password" }));
      upsertFillRule(cipher, rule({ id: "b" }, { from: "field", name: "Deleted field" }));
      const pageDetails = {
        url: PAGE,
        fields: [pageField({ opid: "__4", htmlID: "a" }), pageField({ opid: "__5", htmlID: "b" })],
      } as AutofillPageDetails;
      const fillScript = new AutofillScript();
      const already = pageDetails.fields[0];

      await applyFillRules(
        cipher,
        pageDetails,
        fillScript,
        { __4: already },
        valueFor(cipher),
        fill,
        STARTED,
      );

      expect(fillScript.script).toEqual([]);
    });

    const run = async (
      cipher: CipherView,
      fields: AutofillField[],
      url = PAGE,
      options = STARTED,
      forms: AutofillPageDetails["forms"] = {},
    ) => {
      const fillScript = new AutofillScript();
      const neverFill = await applyFillRules(
        cipher,
        { url, fields, forms } as AutofillPageDetails,
        fillScript,
        {},
        valueFor(cipher),
        fill,
        options,
      );
      return { script: fillScript.script, neverFill: [...neverFill] };
    };

    it("fills only on the scheme the rule was made on, https when it doesn't say", async () => {
      const cipher = loginItem([customField("Customer ID", "C-12345")]);
      upsertFillRule(cipher, rule({ id: "custno" }, { from: "field", name: "Customer ID" }));
      const field = pageField({ opid: "__1", htmlID: "custno" });

      expect((await run(cipher, [field], `http://${HOST}/login`)).script).toEqual([]);
      expect((await run(cipher, [field])).script).toEqual([["fill_by_opid", "__1", "C-12345"]]);

      // A rule made on an http page fills only there.
      const intranet = loginItem([customField("Customer ID", "C-12345")]);
      upsertFillRule(intranet, {
        ...rule({ id: "custno" }, { from: "field", name: "Customer ID" }),
        scheme: "http",
      });
      expect((await run(intranet, [field])).script).toEqual([]);
      expect((await run(intranet, [field], `http://${HOST}/login`)).script).toEqual([
        ["fill_by_opid", "__1", "C-12345"],
      ]);
    });

    it("keeps one rule per field and site, the scheme included", () => {
      const cipher = loginItem();
      upsertFillRule(cipher, rule({ id: "a" }, { from: "username" }));
      upsertFillRule(cipher, { ...rule({ id: "a" }, { from: "password" }), scheme: "http" });
      upsertFillRule(cipher, rule({ id: "a" }, { from: "never" }));

      expect(readFillRules(cipher)).toEqual([
        { ...rule({ id: "a" }, { from: "password" }), scheme: "http" },
        rule({ id: "a" }, { from: "never" }),
      ]);
    });

    it("never fills a field upstream never would: a search box, a captcha, a newsletter form", async () => {
      const cipher = loginItem([customField("Customer ID", "C-12345")]);
      upsertFillRule(cipher, rule({ id: "q" }, { from: "password" }));
      upsertFillRule(cipher, rule({ id: "query" }, { from: "username" }));
      upsertFillRule(cipher, rule({ id: "captcha-answer" }, { from: "field", name: "Customer ID" }));
      upsertFillRule(cipher, rule({ id: "news-email" }, { from: "username" }));
      upsertFillRule(cipher, rule({ id: "member" }, { from: "username" }));

      const result = await run(
        cipher,
        [
          pageField({ opid: "__1", htmlID: "q", type: "search" }),
          pageField({ opid: "__2", htmlID: "query", type: "text" }),
          pageField({ opid: "__3", htmlID: "captcha-answer", type: "text" }),
          pageField({ opid: "__4", htmlID: "news-email", type: "email", form: "f1" }),
          pageField({ opid: "__5", htmlID: "member", type: "text" }),
        ],
        PAGE,
        STARTED,
        { f1: { opid: "f1", htmlID: "newsletter-signup" } } as AutofillPageDetails["forms"],
      );

      expect(result.script).toEqual([["fill_by_opid", "__5", "alice"]]);
    });

    it("keeps upstream's limits on page load: empty fields only, no code, no username alone", async () => {
      const cipher = loginItem();
      upsertFillRule(cipher, rule({ id: "member" }, { from: "username" }));
      upsertFillRule(cipher, rule({ id: "otp" }, { from: "totp" }));
      upsertFillRule(cipher, rule({ id: "pw" }, { from: "password" }));
      const member = pageField({ opid: "__1", htmlID: "member", type: "text" });
      const otp = pageField({ opid: "__2", htmlID: "otp", type: "text" });
      const typed = pageField({ opid: "__3", htmlID: "pw", type: "password", value: "typed" });
      const pw = pageField({ opid: "__3", htmlID: "pw", type: "password" });

      // A username on a page without a password field, and a code: not on page load.
      expect((await run(cipher, [member, otp], PAGE, PAGE_LOAD)).script).toEqual([]);
      expect((await run(cipher, [member, otp])).script).toEqual([
        ["fill_by_opid", "__1", "alice"],
        ["fill_by_opid", "__2", "123456"],
      ]);
      // A field that has a value keeps it on page load.
      expect((await run(cipher, [member, typed], PAGE, PAGE_LOAD)).script).toEqual([
        ["fill_by_opid", "__1", "alice"],
      ]);
      expect((await run(cipher, [member, pw], PAGE, PAGE_LOAD)).script).toEqual([
        ["fill_by_opid", "__1", "alice"],
        ["fill_by_opid", "__3", "correct-password"],
      ]);
      // A code only where the account may use one.
      expect(
        (await run(cipher, [otp], PAGE, { ...STARTED, allowTotp: false })).script,
      ).toEqual([]);
    });

    it("fills only on the host the rule was made on", async () => {
      const cipher = loginItem([customField("Customer ID", "C-12345")]);
      upsertFillRule(cipher, rule({ id: "custno" }, { from: "field", name: "Customer ID" }));
      const field = pageField({ opid: "__1", htmlID: "custno" });

      expect((await run(cipher, [field], "https://evil.example.com/login")).script).toEqual([]);
      expect((await run(cipher, [field], "https://sub.bank.example.com/login")).script).toEqual([]);
      expect((await run(cipher, [field], "https://bank.example.com:8443/login")).script).toEqual(
        [],
      );
      expect((await run(cipher, [field])).script).toEqual([["fill_by_opid", "__1", "C-12345"]]);
    });

    it("fills nothing from a rule without a host, though its never-fill still holds", async () => {
      const cipher = loginItem();
      upsertFillRule(cipher, rule({ id: "a" }, { from: "password" }, null));
      upsertFillRule(cipher, rule({ id: "b" }, { from: "never" }, null));
      const result = await run(cipher, [
        pageField({ opid: "__1", htmlID: "a", type: "password" }),
        pageField({ opid: "__2", htmlID: "b" }),
      ]);

      expect(result).toEqual({ script: [], neverFill: ["__2"] });
    });

    it("never fills a field the person can't see", async () => {
      const cipher = loginItem([customField("Customer ID", "C-12345")]);
      upsertFillRule(
        cipher,
        rule({ label: "customer id" }, { from: "field", name: "Customer ID" }),
      );

      expect(
        (
          await run(cipher, [
            pageField({ opid: "__1", "label-tag": "Customer ID", viewable: false }),
            pageField({ opid: "__2", "label-tag": "Customer ID", type: "hidden" }),
          ])
        ).script,
      ).toEqual([]);
    });

    it("puts a hidden value only into a password field for someone who can't see passwords", async () => {
      const cipher = loginItem([customField("PIN", "4321", FieldType.Hidden)]);
      cipher.viewPassword = false;
      upsertFillRule(cipher, rule({ id: "pw" }, { from: "password" }));
      upsertFillRule(cipher, rule({ id: "pin" }, { from: "field", name: "PIN" }));

      expect(
        (
          await run(cipher, [
            pageField({ opid: "__1", htmlID: "pw", type: "text" }),
            pageField({ opid: "__2", htmlID: "pin", type: "text" }),
          ])
        ).script,
      ).toEqual([]);
      expect(
        (
          await run(cipher, [
            pageField({ opid: "__1", htmlID: "pw", type: "password" }),
            pageField({ opid: "__2", htmlID: "pin", type: "password" }),
          ])
        ).script,
      ).toEqual([
        ["fill_by_opid", "__1", "correct-password"],
        ["fill_by_opid", "__2", "4321"],
      ]);
    });

    it("treats a name a hidden field shares as secret, so its value never shows to someone who can't see passwords", async () => {
      const cipher = loginItem([
        customField("PIN", "4321", FieldType.Hidden),
        customField("PIN", "shown", FieldType.Text),
      ]);
      cipher.viewPassword = false;
      upsertFillRule(cipher, rule({ id: "pin" }, { from: "field", name: "PIN" }));

      // A name a hidden field shares counts as secret: it goes only into a password field.
      expect(
        (await run(cipher, [pageField({ opid: "__2", htmlID: "pin", type: "text" })])).script,
      ).toEqual([]);
      expect(
        (await run(cipher, [pageField({ opid: "__2", htmlID: "pin", type: "password" })])).script,
      ).toEqual([["fill_by_opid", "__2", "4321"]]);
    });

    it("does nothing for an item without rules", async () => {
      const cipher = loginItem([customField("Customer ID", "C-12345")]);
      const fillScript = new AutofillScript();
      const valueForSpy = jest.fn();

      await applyFillRules(
        cipher,
        { url: PAGE, fields: [pageField({})] } as AutofillPageDetails,
        fillScript,
        {},
        valueForSpy,
        fill,
        STARTED,
      );

      expect(valueForSpy).not.toHaveBeenCalled();
      expect(fillScript.script).toEqual([]);
    });
  });
});
