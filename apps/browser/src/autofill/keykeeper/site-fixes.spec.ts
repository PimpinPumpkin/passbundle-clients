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

import {
  applyFillRules,
  FillRule,
  keykeeperSiteFixes,
  staticValueFor,
  upsertFillRule,
} from "./fill-rules";
import { KeykeeperSiteFixes, SHARE_SITE_FIXES, SiteFix, toFix, toRule } from "./site-fixes";

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
      );
    } finally {
      keykeeperSiteFixes.rulesFor = original;
    }
    // The item's never-fill holds; the fix fills the visible field only.
    expect(fillScript.script).toEqual([["fill_by_opid", "__1", "ana"]]);
  });
});
