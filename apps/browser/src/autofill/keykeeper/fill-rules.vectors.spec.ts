// Keykeeper: the fill rules' shared test vectors (the meta repo's
// docs/vectors/fill-rules-v1.json, copied here as fill-rules-v1.vectors.json),
// which the apps' core checks too (passbundle-apps, core/src/fill_rules.rs):
// each page, item, and never-fill list fills where the vectors say, through
// applyFillRules with upstream's limits for a fill the person started. Cases
// marked `apps` need what only Android leaves out (a page's scheme), so they
// aren't for here.

import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { isFillRule } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import AutofillScript from "../models/autofill-script";
import AutofillService from "../services/autofill.service";

import {
  applyFillRules,
  fieldValueFor,
  FillRule,
  FillSource,
  keykeeperSiteNeverFill,
  ruleAppliesOn,
} from "./fill-rules";
import vectors from "./fill-rules-v1.vectors.json";

type VectorField = {
  tag?: string;
  type?: string;
  id?: string;
  name?: string;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  autocomplete?: string;
  visible: boolean;
  list?: boolean;
  maxLength?: number;
  form?: number;
};

type VectorItem = {
  type: "login" | "card" | "identity";
  seesSecrets: boolean;
  codes: boolean;
  username?: string;
  password?: string;
  totp?: string;
  fields: { name: string; type: number; value?: string; rule?: unknown }[];
  card?: Record<string, string>;
  identity?: Record<string, string>;
};

type Case = {
  name: string;
  apps?: boolean;
  page: { scheme: string | null; host: string; fields: VectorField[]; forms?: (string | null)[] };
  item: VectorItem;
  neverFill: unknown[];
  fills: { field: number; fill: FillSource }[];
  never: number[];
};

function cipherOf(item: VectorItem): CipherView {
  const cipher = new CipherView();
  cipher.viewPassword = item.seesSecrets;
  cipher.fields = item.fields.map((f) => {
    const field = new FieldView();
    field.name = f.name;
    field.type = f.type as FieldType;
    // A rule as it's kept: its JSON text.
    field.value = f.rule !== undefined ? JSON.stringify(f.rule) : (f.value ?? null);
    return field;
  });
  if (item.type === "login") {
    cipher.type = CipherType.Login;
    cipher.login = new LoginView();
    cipher.login.username = item.username ?? null;
    cipher.login.password = item.password ?? null;
    cipher.login.totp = item.totp ?? null;
  } else if (item.type === "card") {
    cipher.type = CipherType.Card;
    cipher.card = Object.assign(new CardView(), item.card);
  } else {
    cipher.type = CipherType.Identity;
    cipher.identity = Object.assign(new IdentityView(), item.identity);
  }
  return cipher;
}

function pageOf(page: Case["page"]): AutofillPageDetails {
  const fields = page.fields.map(
    (f, at) =>
      ({
        opid: `__${at}`,
        elementNumber: at,
        viewable: f.visible,
        htmlID: f.id ?? null,
        htmlName: f.name ?? null,
        htmlClass: null,
        tabindex: null,
        title: null,
        tagName: f.tag ?? null,
        type: f.type,
        "label-tag": f.label,
        "label-aria": f.ariaLabel ?? null,
        placeholder: f.placeholder ?? null,
        autoCompleteType: f.autocomplete ?? null,
        maxLength: f.maxLength ?? null,
        form: f.form != null ? `__form${f.form}` : null,
      }) as AutofillField,
  );
  const forms = Object.fromEntries(
    (page.forms ?? []).map((name, at) => [
      `__form${at}`,
      { opid: `__form${at}`, htmlName: name ?? "", htmlID: "", htmlAction: "", htmlClass: "" },
    ]),
  ) as AutofillPageDetails["forms"];
  return { url: `${page.scheme}://${page.host}/`, fields, forms } as AutofillPageDetails;
}

describe("Keykeeper fill rules: the shared vectors", () => {
  const original = keykeeperSiteNeverFill.rulesFor;
  afterEach(() => {
    keykeeperSiteNeverFill.rulesFor = original;
  });

  const cases = (vectors as { cases: Case[] }).cases;

  it("has them", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(cases.filter((c) => !c.apps).map((c) => [c.name, c] as const))("%s", async (_, c) => {
    // As the account's list gives them (site-never-fill.ts): never rules with a site, for this page.
    keykeeperSiteNeverFill.rulesFor = async (url) =>
      (c.neverFill as FillRule[]).filter(
        (rule) =>
          isFillRule(rule) &&
          rule.fill.from === "never" &&
          typeof rule.host === "string" &&
          rule.host !== "" &&
          ruleAppliesOn(rule, url),
      );
    const cipher = cipherOf(c.item);
    const fillScript = new AutofillScript();
    // The value each source fills, as the extension takes it, named by its source.
    const valueFor = async (source: FillSource, field: AutofillField) => {
      const value =
        source.from === "totp"
          ? (cipher.login?.totp ?? null)
          : fieldValueFor(cipher, source, field);
      return value == null || value === "" ? null : JSON.stringify(source);
    };
    const neverFill = await applyFillRules(
      cipher,
      pageOf(c.page),
      fillScript,
      {},
      valueFor,
      (script, field, value) => script.script.push(["fill_by_opid", field.opid, value]),
      {
        userStarted: true,
        onlyEmptyFields: false,
        skipUsernameOnlyFill: false,
        allowTotp: c.item.codes,
        excluded: AutofillService.isExcludedFromFillRules,
      },
    );
    const at = (opid: string) => Number(opid.slice(2));
    expect(
      fillScript.script.map(([, opid, value]) => ({ field: at(opid), fill: JSON.parse(value) })),
    ).toEqual(c.fills);
    expect([...neverFill].map(at).sort((a, b) => a - b)).toEqual(c.never);
  });
});
