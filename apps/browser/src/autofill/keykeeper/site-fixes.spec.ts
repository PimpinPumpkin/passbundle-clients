import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import AutofillScript from "../models/autofill-script";
import AutofillService from "../services/autofill.service";

import {
  applyFillRules,
  FillRule,
  FillRuleOptions,
  keykeeperSiteFixes,
  staticValueFor,
  upsertFillRule,
} from "./fill-rules";
import {
  hasPersonal,
  KeykeeperSiteFixes,
  scrubPersonal,
  SHARE_SITE_FIXES,
  SiteFix,
  toFix,
  toRule,
  USE_SITE_FIXES,
} from "./site-fixes";

const STARTED: FillRuleOptions = {
  userStarted: true,
  onlyEmptyFields: false,
  skipUsernameOnlyFill: false,
  allowTotp: true,
  excluded: AutofillService.isExcludedFromFillRules,
};

const USER = "user-1" as UserId;
const HOST = "bank.example.test";

const rule = (field: FillRule["field"], fill: FillRule["fill"], host = HOST): FillRule => ({
  v: 1,
  host,
  field,
  fill,
});

function setUp(list: { fixes: SiteFix[]; rules: SiteFix[] } = { fixes: [], rules: [] }) {
  const apiService = mock<ApiService>();
  apiService.send.mockImplementation(async (method: string) => (method === "GET" ? list : {}));
  const authService = mock<AuthService>();
  authService.authStatusFor$.mockReturnValue(new BehaviorSubject(AuthenticationStatus.Unlocked));
  const accountService = mockAccountServiceWith(USER);
  const stateProvider = new FakeStateProvider(accountService);
  const service = new KeykeeperSiteFixes(apiService, accountService, authService, stateProvider);
  return { service, apiService, stateProvider };
}

describe("Site fixes", () => {
  it("share the site, the field, and the kind of value, never a custom field or a value", () => {
    expect(toFix(rule({ id: "custno", label: "customer number" }, { from: "username" }))).toEqual({
      host: HOST,
      field: { id: "custno", name: "", label: "customer number" },
      fill: "username",
    });
    expect(toFix(rule({ id: "pin" }, { from: "field", name: "PIN" }))).toBeNull();
    expect(toFix({ v: 1, field: { id: "pw" }, fill: { from: "password" } })).toBeNull();
    expect(toFix(rule({}, { from: "password" }))).toBeNull();
    expect(
      toRule({ host: HOST, field: { id: "pw", name: "", label: "" }, fill: "password" }),
    ).toEqual(rule({ id: "pw" }, { from: "password" }));
    expect(
      toRule({ host: HOST, field: { id: "x", name: "", label: "" }, fill: "field" as never }),
    ).toBeNull();
  });

  it("are shared only by people who turned sharing on", async () => {
    const { service, apiService, stateProvider } = setUp();
    const made = rule({ id: "custno" }, { from: "username" });

    await service.share(made);
    expect(apiService.send).not.toHaveBeenCalled();

    await stateProvider.getUser(USER, SHARE_SITE_FIXES).update(() => true);
    await service.share(made);
    await service.share(rule({ id: "pin" }, { from: "field", name: "PIN" }));
    expect(apiService.send.mock.calls).toEqual([
      ["POST", "/keykeeper/site-fixes", toFix(made), true, true],
    ]);
  });

  it("come down as a whole list and are matched on the device, MSP rules first", async () => {
    const fix: SiteFix = {
      host: HOST,
      field: { id: "", name: "", label: "customer number" },
      fill: "username",
    };
    const mspRule: SiteFix = {
      host: HOST,
      field: { id: "pw", name: "", label: "" },
      fill: "password",
    };
    const elsewhere: SiteFix = { ...fix, host: "other.example.test" };
    const { service, apiService } = setUp({ fixes: [fix, elsewhere], rules: [mspRule] });

    await service.refresh(USER);
    // One request, for everything: the server never hears which site.
    expect(apiService.send).toHaveBeenCalledWith("GET", "/keykeeper/site-fixes", null, true, true);
    expect(await service.rulesFor(`https://${HOST}/login`)).toEqual([toRule(mspRule), toRule(fix)]);
    expect(await service.rulesFor("https://nowhere.example.test/")).toEqual([]);
  });

  it("fill a field the item has no rule for, with the same limits, and never over the item's own rule", async () => {
    const cipher = new CipherView();
    cipher.type = CipherType.Login;
    cipher.login = new LoginView();
    cipher.login.username = "ana";
    cipher.login.password = "secret";
    upsertFillRule(cipher, rule({ id: "custno" }, { from: "never" }));
    const original = keykeeperSiteFixes.rulesFor;
    keykeeperSiteFixes.rulesFor = async () => [
      rule({ id: "custno" }, { from: "username" }),
      rule({ id: "member" }, { from: "username" }),
      rule({ id: "hidden-member" }, { from: "username" }),
    ];
    const field = (opid: string, htmlID: string, viewable = true) =>
      ({ opid, htmlID, viewable, type: "text" }) as AutofillField;
    const fillScript = new AutofillScript();
    try {
      await applyFillRules(
        cipher,
        {
          url: `https://${HOST}/login`,
          fields: [
            field("__0", "custno"),
            field("__1", "member"),
            field("__2", "hidden-member", false),
          ],
        } as AutofillPageDetails,
        fillScript,
        {},
        async (source) => staticValueFor(cipher, source),
        (script, f, value) => script.script.push(["fill_by_opid", f.opid, value]),
        STARTED,
      );
    } finally {
      keykeeperSiteFixes.rulesFor = original;
    }
    // The item's never-fill holds; the fix fills the visible field only.
    expect(fillScript.script).toEqual([["fill_by_opid", "__1", "ana"]]);
  });

  describe("from the server", () => {
    const cipher = () => {
      const c = new CipherView();
      c.type = CipherType.Login;
      c.login = new LoginView();
      c.login.username = "ana";
      c.login.password = "secret";
      return c;
    };
    const field = (opid: string, htmlID: string, type = "text") =>
      ({ opid, htmlID, viewable: true, type }) as AutofillField;
    const fillWith = async (
      fixes: FillRule[],
      fields: AutofillField[],
      options = STARTED,
      url = `https://${HOST}/login`,
    ) => {
      const item = cipher();
      const original = keykeeperSiteFixes.rulesFor;
      const asked: string[] = [];
      keykeeperSiteFixes.rulesFor = async (u) => {
        asked.push(u);
        return fixes;
      };
      const fillScript = new AutofillScript();
      try {
        await applyFillRules(
          item,
          { url, fields } as AutofillPageDetails,
          fillScript,
          {},
          async (source) => staticValueFor(item, source),
          (script, f, value) => script.script.push(["fill_by_opid", f.opid, value]),
          options,
        );
      } finally {
        keykeeperSiteFixes.rulesFor = original;
      }
      return { script: fillScript.script, asked };
    };

    it("put a password only into a password field, even for someone who can see it", async () => {
      const fixes = [rule({ id: "q" }, { from: "password" }), rule({ id: "pw" }, { from: "password" })];

      expect(
        (await fillWith(fixes, [field("__0", "q"), field("__1", "pw", "password")])).script,
      ).toEqual([["fill_by_opid", "__1", "secret"]]);
    });

    it("keep upstream's exclusions: never a search box", async () => {
      const fixes = [rule({ id: "q" }, { from: "username" })];

      expect((await fillWith(fixes, [field("__0", "q", "search")])).script).toEqual([]);
    });

    it("fill only when the person fills, never on page load", async () => {
      const fixes = [rule({ id: "member" }, { from: "username" })];
      const pageLoad = { ...STARTED, userStarted: false };

      const loaded = await fillWith(fixes, [field("__0", "member")], pageLoad);
      expect(loaded).toEqual({ script: [], asked: [] });
      expect((await fillWith(fixes, [field("__0", "member")])).script).toEqual([
        ["fill_by_opid", "__0", "ana"],
      ]);
    });

    it("fill only on https pages", async () => {
      const { service } = setUp({
        fixes: [{ host: HOST, field: { id: "member", name: "", label: "" }, fill: "username" }],
        rules: [],
      });
      await service.refresh(USER);

      expect(await service.rulesFor(`http://${HOST}/login`)).toEqual([]);
      expect(await service.rulesFor(`https://${HOST}/login`)).toEqual([
        rule({ id: "member" }, { from: "username" }),
      ]);
      // And a rule made on an http page isn't shared as one.
      expect(toFix({ ...rule({ id: "member" }, { from: "username" }), scheme: "http" })).toBeNull();
    });

    it("can be turned off: then none fill and the list isn't downloaded", async () => {
      const fix: SiteFix = { host: HOST, field: { id: "pw", name: "", label: "" }, fill: "password" };
      const { service, apiService, stateProvider } = setUp({ fixes: [fix], rules: [] });
      await service.refresh(USER);
      expect(await service.rulesFor(`https://${HOST}/login`)).toEqual([toRule(fix)]);

      await stateProvider.getUser(USER, USE_SITE_FIXES).update(() => false);
      apiService.send.mockClear();
      await service.refresh(USER);
      expect(apiService.send).not.toHaveBeenCalled();
      expect(await service.rulesFor(`https://${HOST}/login`)).toEqual([]);
    });
  });

  describe("never carry an email address or phone number", () => {
    it("leave out a label that has one, and keep a fix whose id has one on the device", () => {
      expect(
        toFix(rule({ id: "code", label: "code sent to +1 (555) 010-1234" }, { from: "totp" })),
      ).toEqual({ host: HOST, field: { id: "code", name: "", label: "" }, fill: "totp" });
      expect(
        toFix(rule({ name: "pw", label: "password for ana@example.test" }, { from: "password" })),
      ).toEqual({ host: HOST, field: { id: "", name: "pw", label: "" }, fill: "password" });
      // Known only by a label like that, it isn't shared at all.
      expect(toFix(rule({ label: "ana@example.test" }, { from: "username" }))).toBeNull();
      expect(toFix(rule({ id: "ana@example.test" }, { from: "username" }))).toBeNull();
      // A long number in an id is the page's, not the person's.
      expect(toFix(rule({ id: "input-20261001" }, { from: "username" }))).toEqual({
        host: HOST,
        field: { id: "input-20261001", name: "", label: "" },
        fill: "username",
      });
    });

    it("scrub them from what a problem report shows", () => {
      expect(scrubPersonal("Code sent to +44 20 7946 0958 or ana.b@example.test", "label")).toBe(
        "Code sent to (phone number) or (email address)",
      );
      expect(scrubPersonal("user-20261001", "id")).toBe("user-20261001");
      expect(hasPersonal("Email address", "label")).toBe(false);
      expect(hasPersonal("x".repeat(300), "label")).toBe(true);
    });
  });
});
