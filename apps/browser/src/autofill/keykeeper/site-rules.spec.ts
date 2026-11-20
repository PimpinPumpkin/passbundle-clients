/**
 * @jest-environment node
 */
// Node's environment, not jsdom's: node-forge's Ed25519 tells bytes apart by
// `instanceof ArrayBuffer`, which jsdom's second set of globals breaks. The
// extension has one set, as here.
import { createHash, createPrivateKey, sign, webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom, of } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import {
  Environment,
  EnvironmentService,
} from "@bitwarden/common/platform/abstractions/environment.service";
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
  keykeeperSiteRules,
  staticValueFor,
  upsertFillRule,
} from "./fill-rules";
import { USE_SITE_FIXES } from "./site-fixes";
import { KeykeeperSiteRules, USE_PASSBUNDLE_SITE_RULES } from "./site-rules";
import type { SiteRule } from "./site-rules-feed";
import vectors from "./site-rules-v1.vectors.json";

const USER = "user-1" as UserId;
const API = "https://vault.example.test/api";
const HOST = "login.example.test";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// The test vectors' key: test only, handed to the service here, never built in.
const testKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(vectors.key.seed, "hex"),
  ]),
  format: "der",
  type: "pkcs8",
});

type Files = Record<string, string>;

/** A feed's three files, signed with the vectors' key as tools/site-rules/sign.mjs signs them. */
function feed(
  hosts: Record<string, unknown>,
  { sequence = 1, issued = NOW - DAY, expires = NOW + 13 * DAY } = {},
): Files {
  const rules = JSON.stringify({ schemaVersion: "1.0.0", hosts });
  const sha256 = createHash("sha256").update(rules).digest("hex");
  const filename = `forms-${sha256.slice(0, 16)}.json`;
  const manifest = JSON.stringify({
    maps: { forms: { v1: { filename, cid: sha256, sha256 } } },
    passbundle: { sequence, issued: iso(issued), expires: iso(expires) },
  });
  const signature = sign(null, Buffer.from(`PassBundle site rules v1\n${manifest}`), testKey);
  return {
    "manifest.json": manifest,
    "manifest.json.sig": `${signature.toString("base64")}\n`,
    [filename]: rules,
  };
}

const shadowSignIn = {
  forms: [
    {
      category: "account-login",
      fields: {
        username: ["#signin-box >>> #member-number"],
        password: ["#signin-box >>> #secret"],
      },
      passbundle: { id: "shadow", verified: "2026-11-15" },
    },
  ],
};

function setUp({ passBundleKeys }: { passBundleKeys?: string[] } = {}) {
  const server = {
    source: { feed: "passbundle" } as Record<string, unknown> | null,
    files: {} as Files,
    asked: [] as string[],
    status: 200,
  };
  const apiService = mock<ApiService>();
  apiService.getActiveBearerToken.mockResolvedValue("access-token");
  apiService.fetch.mockImplementation(async (request: Request) => {
    expect(request.headers.get("Authorization")).toBe("Bearer access-token");
    const path = request.url.slice(API.length);
    server.asked.push(path);
    if (server.status !== 200) {
      return new Response("", { status: server.status });
    }
    if (path === "/keykeeper/site-rules") {
      return server.source == null
        ? new Response("", { status: 404 })
        : new Response(JSON.stringify(server.source), { status: 200 });
    }
    const name = decodeURIComponent(path.replace("/keykeeper/site-rules/", ""));
    return Object.prototype.hasOwnProperty.call(server.files, name)
      ? new Response(server.files[name], { status: 200 })
      : new Response("", { status: 404 });
  });
  const authService = mock<AuthService>();
  authService.authStatusFor$.mockReturnValue(new BehaviorSubject(AuthenticationStatus.Unlocked));
  const accountService = mockAccountServiceWith(USER);
  const stateProvider = new FakeStateProvider(accountService);
  const environmentService = mock<EnvironmentService>();
  environmentService.getEnvironment$.mockReturnValue(
    of({ getApiUrl: () => API } as unknown as Environment),
  );
  const clock = { now: NOW };
  const service = new KeykeeperSiteRules({
    apiService,
    accountService,
    authService,
    stateProvider,
    environmentService,
    passBundleKeys,
    now: () => clock.now,
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
  });
  return { service, server, apiService, stateProvider, clock };
}

const ids = (rules: SiteRule[]) => rules.map((r) => r.id);

describe("Site rules from a signed feed", () => {
  describe("PassBundle's feed", () => {
    it("is refused by a build's own key list, which is empty: nothing is even downloaded", async () => {
      const { service, server } = setUp();
      server.files = feed({ [HOST]: shadowSignIn });

      await service.refresh(USER);
      expect(server.asked).toEqual(["/keykeeper/site-rules"]);
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);
    });

    it("is taken with a key the test hands it, and fills only on https pages", async () => {
      const { service, server } = setUp({ passBundleKeys: [vectors.key.public] });
      server.files = feed({ [HOST]: shadowSignIn });

      await service.refresh(USER);
      expect(ids(await service.rulesFor(`https://${HOST}/sign-in`))).toEqual(["shadow"]);
      expect(await service.rulesFor(`http://${HOST}/sign-in`)).toEqual([]);
      expect(await service.rulesFor(`https://other.example.test/`)).toEqual([]);
      expect(await service.selectorsFor(`https://${HOST}/`)).toEqual([
        "#signin-box >>> #member-number",
        "#signin-box >>> #secret",
      ]);
    });

    it("can be turned off: then nothing is downloaded, the copy kept goes, and none fill", async () => {
      const { service, server, stateProvider } = setUp({ passBundleKeys: [vectors.key.public] });
      server.files = feed({ [HOST]: shadowSignIn });
      await service.refresh(USER);

      await stateProvider.getUser(USER, USE_PASSBUNDLE_SITE_RULES).update(() => false);
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);
      server.asked = [];
      await service.refresh(USER);
      expect(server.asked).toEqual(["/keykeeper/site-rules"]);
      expect(
        await firstValueFrom(stateProvider.getUser(USER, KeykeeperSiteRules.KEPT).state$),
      ).toBeNull();
      // "Use fixes other people share" is another setting.
      await stateProvider.getUser(USER, USE_PASSBUNDLE_SITE_RULES).update(() => true);
      await stateProvider.getUser(USER, USE_SITE_FIXES).update(() => false);
      await service.refresh(USER);
      expect(ids(await service.rulesFor(`https://${HOST}/`))).toEqual(["shadow"]);
    });
  });

  describe("an operator's feed", () => {
    it("is checked with the key its server names, and is used as site fixes are", async () => {
      const { service, server, stateProvider } = setUp();
      server.source = { feed: "operator", key: vectors.key.public };
      server.files = feed({ [HOST]: shadowSignIn });

      await service.refresh(USER);
      expect(ids(await service.rulesFor(`https://${HOST}/`))).toEqual(["shadow"]);

      // "Use PassBundle's site rules" isn't the setting for it; "Use fixes other people share" is.
      await stateProvider.getUser(USER, USE_PASSBUNDLE_SITE_RULES).update(() => false);
      expect(ids(await service.rulesFor(`https://${HOST}/`))).toEqual(["shadow"]);
      await stateProvider.getUser(USER, USE_SITE_FIXES).update(() => false);
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);
      server.asked = [];
      await service.refresh(USER);
      expect(server.asked).toEqual(["/keykeeper/site-rules"]);
    });

    it("signed with another key than its server names is refused", async () => {
      const { service, server } = setUp();
      server.source = { feed: "operator", key: vectors.otherKey.public };
      server.files = feed({ [HOST]: shadowSignIn });

      await service.refresh(USER);
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);
    });

    it("whose key isn't one a signature may check with is no feed (the neutral point)", async () => {
      const { service, server } = setUp();
      server.source = { feed: "operator", key: `01${"00".repeat(31)}` };
      server.files = feed({ [HOST]: shadowSignIn });

      await service.refresh(USER);
      expect(server.asked).toEqual(["/keykeeper/site-rules"]);
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);
    });

    it("is never checked with PassBundle's keys", async () => {
      const { service, server } = setUp({ passBundleKeys: [vectors.key.public] });
      server.source = { feed: "operator", key: vectors.otherKey.public };
      server.files = feed({ [HOST]: shadowSignIn });
      await service.refresh(USER);
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);
    });
  });

  describe("checking again", () => {
    const signedIn = async (hosts = { [HOST]: shadowSignIn }) => {
      const set = setUp({ passBundleKeys: [vectors.key.public] });
      set.server.files = feed(hosts, { sequence: 5 });
      await set.service.refresh(USER);
      expect(ids(await set.service.rulesFor(`https://${HOST}/`))).toEqual(["shadow"]);
      set.server.asked = [];
      return set;
    };

    it("downloads the rules file only when its SHA-256 changed", async () => {
      const { service, server } = await signedIn();

      await service.refresh(USER);
      expect(server.asked).toEqual([
        "/keykeeper/site-rules",
        "/keykeeper/site-rules/manifest.json",
        "/keykeeper/site-rules/manifest.json.sig",
      ]);

      // Signed again with a later expiry, the same rules: still no download.
      server.files = feed({ [HOST]: shadowSignIn }, { sequence: 6, expires: NOW + 14 * DAY });
      server.asked = [];
      await service.refresh(USER);
      expect(server.asked).toHaveLength(3);

      // New rules: downloaded.
      const changed = {
        ...shadowSignIn,
        forms: [
          { ...shadowSignIn.forms[0], passbundle: { id: "shadow-2", verified: "2026-11-18" } },
        ],
      };
      server.files = feed({ [HOST]: changed }, { sequence: 7 });
      server.asked = [];
      await service.refresh(USER);
      expect(server.asked).toHaveLength(4);
      expect(server.asked[3]).toMatch(/^\/keykeeper\/site-rules\/forms-[0-9a-f]{16}\.json$/);
      expect(ids(await service.rulesFor(`https://${HOST}/`))).toEqual(["shadow-2"]);
    });

    it.each([
      [
        "a bad signature",
        (files: Files) => ({
          ...files,
          "manifest.json.sig": files["manifest.json.sig"].replace(/^./, (c) =>
            c === "A" ? "B" : "A",
          ),
        }),
      ],
      [
        "one byte of the manifest changed",
        (files: Files) => ({
          ...files,
          "manifest.json": files["manifest.json"].replace('"sequence":9', '"sequence":8'),
        }),
      ],
      ["an older sequence (a rollback)", () => feed({ [HOST]: { forms: [] } }, { sequence: 4 })],
      [
        "a rules file that isn't the one named",
        (files: Files) => {
          const name = Object.keys(files).find((n) => n.startsWith("forms-"))!;
          return { ...files, [name]: files[name].replace("shadow-new", "shadow-bad") };
        },
      ],
      [
        "an expired feed",
        () =>
          feed(
            { [HOST]: { forms: [] } },
            { sequence: 9, issued: NOW - 15 * DAY, expires: NOW - DAY },
          ),
      ],
      ["a server that's offline", (): Files | null => null],
    ] as [string, (files: Files) => Files | null][])(
      "keeps what it had when a new feed fails: %s",
      async (_name, change) => {
        const { service, server } = await signedIn();
        const newer = feed(
          {
            [HOST]: {
              forms: [
                {
                  ...shadowSignIn.forms[0],
                  passbundle: { id: "shadow-new", verified: "2026-11-18" },
                },
              ],
            },
          },
          { sequence: 9 },
        );
        const files = change(newer);
        if (files == null) {
          server.status = 503;
        } else {
          server.files = files;
        }

        await service.refresh(USER);
        expect(ids(await service.rulesFor(`https://${HOST}/`))).toEqual(["shadow"]);
      },
    );

    it("drops it all when the copy kept expires, even with the server offline", async () => {
      const kept = (set: Awaited<ReturnType<typeof signedIn>>) =>
        firstValueFrom(set.stateProvider.getUser(USER, KeykeeperSiteRules.KEPT).state$);
      const set = await signedIn();
      const { service, server, clock } = set;
      server.status = 503;

      clock.now = NOW + 13 * DAY - 1000;
      expect(ids(await service.rulesFor(`https://${HOST}/`))).toEqual(["shadow"]);
      clock.now = NOW + 13 * DAY;
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);
      // Gone from the device, not only unused.
      expect(await kept(set)).toBeNull();

      // And a check finds it expired even before anything asks for rules.
      const again = await signedIn();
      again.server.status = 503;
      again.clock.now = NOW + 13 * DAY;
      await again.service.refresh(USER);
      expect(await kept(again)).toBeNull();
    });

    it("drops the copy when the server stops mirroring a feed, or mirrors another's", async () => {
      const { service, server } = await signedIn();
      server.source = { feed: "operator", key: vectors.otherKey.public };
      await service.refresh(USER);
      expect(await service.rulesFor(`https://${HOST}/`)).toEqual([]);

      const again = await signedIn();
      again.server.source = { feed: "none" };
      await again.service.refresh(USER);
      expect(await again.service.rulesFor(`https://${HOST}/`)).toEqual([]);
    });

    it("never asks in a way that could sign the person out", async () => {
      const { service, server, apiService } = await signedIn();
      server.status = 401;
      await service.refresh(USER);
      expect(apiService.send).not.toHaveBeenCalled();
      expect(ids(await service.rulesFor(`https://${HOST}/`))).toEqual(["shadow"]);
    });
  });
});

describe("A feed's rules in the fill rules engine", () => {
  const STARTED: FillRuleOptions = {
    userStarted: true,
    onlyEmptyFields: false,
    skipUsernameOnlyFill: false,
    allowTotp: true,
    excluded: AutofillService.isExcludedFromFillRules,
  };
  const cipher = () => {
    const c = new CipherView();
    c.type = CipherType.Login;
    c.login = new LoginView();
    c.login.username = "ana";
    c.login.password = "secret";
    return c;
  };
  const field = (opid: string, selectors: string[], extra: Partial<AutofillField> = {}) =>
    ({
      opid,
      htmlID: opid,
      viewable: true,
      type: "text",
      keykeeperSelectors: selectors,
      ...extra,
    }) as AutofillField;
  const siteRule = (fields: SiteRule["fields"], id = "r1"): SiteRule => ({
    id,
    path: null,
    verified: "2026-11-15",
    fields,
  });

  async function fillWith(
    rules: SiteRule[],
    fields: AutofillField[],
    {
      options = STARTED,
      item = cipher(),
      fixes = { msp: [] as FillRule[], confirmed: [] as FillRule[] },
      url = `https://${HOST}/sign-in`,
      code = null as string | null,
    } = {},
  ) {
    const originalRules = keykeeperSiteRules.rulesFor;
    const originalFixes = keykeeperSiteFixes.rulesFor;
    const asked: string[] = [];
    keykeeperSiteRules.rulesFor = async (u) => {
      asked.push(u);
      return rules;
    };
    keykeeperSiteFixes.rulesFor = async () => fixes;
    const fillScript = new AutofillScript();
    const filled = {};
    try {
      await applyFillRules(
        item,
        { url, fields } as AutofillPageDetails,
        fillScript,
        filled,
        async (source) => (source.from === "totp" ? code : staticValueFor(item, source)),
        (script, f, value) => script.script.push(["fill_by_opid", f.opid, value]),
        options,
      );
    } finally {
      keykeeperSiteRules.rulesFor = originalRules;
      keykeeperSiteFixes.rulesFor = originalFixes;
    }
    return { script: fillScript.script, asked, filled };
  }

  it("fills the field each selector found, the first that found one, and leaves the rest to upstream", async () => {
    const { script, filled } = await fillWith(
      [siteRule({ username: ["#gone", "#member"], password: ["#secret"] })],
      [
        field("__0", []),
        field("__1", ["#member"]),
        field("__2", ["#secret"], { type: "password" }),
      ],
    );
    expect(script).toEqual([
      ["fill_by_opid", "__1", "ana"],
      ["fill_by_opid", "__2", "secret"],
    ]);
    // Upstream's matching skips what the rules filled.
    expect(Object.keys(filled).sort()).toEqual(["__1", "__2"]);
  });

  it("never fills on page load: it isn't even asked", async () => {
    const result = await fillWith(
      [siteRule({ username: ["#member"] })],
      [field("__0", ["#member"])],
      { options: { ...STARTED, userStarted: false } },
    );
    expect(result.script).toEqual([]);
    expect(result.asked).toEqual([]);
  });

  it("puts a password only into a password field, and nothing into a field the person can't see", async () => {
    const { script } = await fillWith(
      [siteRule({ password: ["#q"] }), siteRule({ username: ["#hidden"] }, "r2")],
      [field("__0", ["#q"]), field("__1", ["#hidden"], { viewable: false })],
    );
    expect(script).toEqual([]);
  });

  it("keeps upstream's exclusions: never a search box", async () => {
    const { script } = await fillWith(
      [siteRule({ username: ["#q"] })],
      [field("__0", ["#q"], { type: "search" })],
    );
    expect(script).toEqual([]);
  });

  it("fills a one-time code only where the fill allows one", async () => {
    const rules = [siteRule({ totp: ["#code"] })];
    const fields = [field("__0", ["#code"])];
    expect((await fillWith(rules, fields, { code: "123456" })).script).toEqual([
      ["fill_by_opid", "__0", "123456"],
    ]);
    expect(
      (await fillWith(rules, fields, { code: "123456", options: { ...STARTED, allowTotp: false } }))
        .script,
    ).toEqual([]);
  });

  it("comes after the item's own rules and the MSP's, and before confirmed site fixes", async () => {
    const never = (id: string): FillRule => ({
      v: 1,
      host: HOST,
      field: { id },
      fill: { from: "never" },
    });
    const item = cipher();
    upsertFillRule(item, never("a"));
    const { script } = await fillWith(
      [
        siteRule({ username: ["#a"] }, "ra"),
        siteRule({ username: ["#c"] }, "rc"),
        siteRule({ username: ["#d"] }, "rd"),
      ],
      [field("a", ["#a"]), field("c", ["#c"]), field("d", ["#d"])],
      // The item says never for a, an MSP's site rule never for c, and a
      // confirmed fix never for d: the feed's rule fills d only.
      { item, fixes: { msp: [never("c")], confirmed: [never("d")] } },
    );
    expect(script).toEqual([["fill_by_opid", "d", "ana"]]);
  });

  it("only on the page's own host, over https", async () => {
    const rules = [siteRule({ username: ["#member"] })];
    const fields = [field("__0", ["#member"])];
    expect((await fillWith(rules, fields, { url: `http://${HOST}/` })).script).toEqual([]);
  });
});
