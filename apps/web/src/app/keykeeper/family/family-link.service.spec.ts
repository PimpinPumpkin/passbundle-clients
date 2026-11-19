import { webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { KeykeeperJoinSeals } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import { invitedLine, LINK_DOESNT_WORK } from "./family-join.component";
import { joinedHow } from "./family-link.component";
import { FamilyLinkView, KeykeeperFamilyLinkService } from "./family-link.service";
import { familyCompareLine } from "./family-waiting.component";
import { LEGACY_CONTACT_SUGGESTION } from "./legacy-contact-suggestion.component";

const USER = "owner-user" as UserId;
const ORG = "4c2f8a1e-7b3d-4e5f-9a8b-1c2d3e4f5a6b";
const VAULT = "https://vault.example.test";
const familyKey = new SymmetricCryptoKey(new Uint8Array(64).map((_, i) => i)) as OrgKey;
const ownPublicKey = new Uint8Array(48).fill(7);
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;

function fakeEncryptService() {
  const encryptService = mock<EncryptService>();
  encryptService.encryptString.mockImplementation(
    async (plain: string) => new EncString(`2.aXY=|${Buffer.from(plain).toString("base64")}|bWFj`),
  );
  encryptService.decryptString.mockImplementation(async (enc: EncString) =>
    Buffer.from((enc.encryptedString as string).split("|")[1], "base64").toString(),
  );
  return encryptService;
}

/** Opens sealed settings as the tests' fake encryption sealed them. */
const opened = (sealed: string) =>
  JSON.parse(Buffer.from(sealed.split("|")[1], "base64").toString());

function setUp() {
  if (globalThis.crypto?.subtle == null) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
  const apiService = mock<ApiService>();
  const keyService = mock<KeyService>();
  keyService.orgKeys$.mockReturnValue(
    new BehaviorSubject({ [ORG]: familyKey } as Record<OrganizationId, OrgKey>),
  );
  keyService.userPublicKey$.mockReturnValue(of(ownPublicKey));
  const environmentService = mock<EnvironmentService>();
  environmentService.environment$ = of({ getWebVaultUrl: () => VAULT }) as never;
  const stateProvider = new FakeStateProvider(mockAccountServiceWith(USER));
  const service = new KeykeeperFamilyLinkService(
    apiService,
    mockAccountServiceWith(USER),
    keyService,
    environmentService,
    fakeEncryptService(),
    stateProvider,
  );
  return { service, apiService, stateProvider };
}

function viewFrom(body: { sealed: string; automatic?: boolean }, live = true): FamilyLinkView {
  return {
    on: live,
    live,
    automatic: body.automatic ?? false,
    expiresAt: null,
    madeAt: null,
    madeBy: null,
    collectionId: null,
    sealed: body.sealed,
    joins: [],
  };
}

describe("A family's invite link in the web vault", () => {
  it("makes a token and a join secret here, and sends the server the token, never the secret", async () => {
    const { service, apiService } = setUp();
    apiService.send.mockImplementation(async (_m, _p, body) => viewFrom(body));
    await service.make(ORG, { automatic: false, days: 7, collectionId: "folder-1" });

    const [method, path, body] = apiService.send.mock.calls[0];
    expect([method, path]).toEqual(["PUT", `/keykeeper/organizations/${ORG}/family-link`]);
    const settings = opened(body.sealed);
    expect(settings).toMatchObject({ v: 1, organizationId: ORG, on: true, automatic: false });
    expect(settings.token).toMatch(B64URL_32);
    expect(settings.secret).toMatch(B64URL_32);
    expect(settings.token).not.toBe(settings.secret);
    expect(body.token).toBe(settings.token);
    expect(JSON.stringify({ ...body, sealed: null })).not.toContain(settings.secret);
    expect(body).toMatchObject({ automatic: false, days: 7, collectionId: "folder-1" });
    expect(settings.expiresAt - settings.sealedAt).toBeGreaterThanOrEqual(7 * 86_400 - 1);
  });

  it("refuses a lifetime other than 1, 7, or 30 days", async () => {
    const { service, apiService } = setUp();
    await expect(
      service.make(ORG, { automatic: false, days: 14, collectionId: null }),
    ).rejects.toThrow("An invite link works for 1, 7, or 30 days.");
    expect(apiService.send).not.toHaveBeenCalled();
  });

  it("shows the link from its settings, and changes approval keeping the same link", async () => {
    const { service, apiService } = setUp();
    apiService.send.mockImplementation(async (_m, _p, body) => viewFrom(body));
    const made = await service.make(ORG, { automatic: false, days: 1, collectionId: null });
    const first = opened(made.sealed!);

    const shown = await service.shown(ORG, made);
    expect(shown?.address).toBe(
      `${VAULT}/#/family-join?o=${ORG}&t=${first.token}&s=${first.secret}`,
    );

    const changed = await service.setApproval(ORG, made, true);
    const [method, path, body] = apiService.send.mock.calls[1];
    expect([method, path]).toEqual(["PUT", `/keykeeper/organizations/${ORG}/family-link/approval`]);
    expect(body.automatic).toBe(true);
    const second = opened(changed.sealed!);
    expect(second).toMatchObject({
      token: first.token,
      secret: first.secret,
      expiresAt: first.expiresAt,
      automatic: true,
    });
    expect(second.sealedAt > first.sealedAt || second.nonce !== first.nonce).toBe(true);
  });

  it("won't change approval on settings older than the newest it has seen", async () => {
    const { service, apiService } = setUp();
    apiService.send.mockImplementation(async (_m, _p, body) => viewFrom(body));
    const older = await service.make(ORG, { automatic: true, days: 7, collectionId: null });
    await service.make(ORG, { automatic: false, days: 7, collectionId: null });
    // The server shows the older link again.
    await expect(service.setApproval(ORG, older, true)).rejects.toThrow(
      "This link's settings can't be checked here. Make a new link instead.",
    );
    expect(await service.shown(ORG, older)).toBeNull();
  });

  it("turns the link off with settings that say so and carry no token or secret", async () => {
    const { service, apiService } = setUp();
    apiService.send.mockImplementation(async (_m, _p, body) => viewFrom(body, false));
    await service.turnOff(ORG);
    const [method, path, body] = apiService.send.mock.calls[0];
    expect([method, path]).toEqual(["DELETE", `/keykeeper/organizations/${ORG}/family-link`]);
    expect(opened(body.sealed)).toMatchObject({
      on: false,
      token: null,
      secret: null,
      automatic: false,
      expiresAt: null,
    });
  });

  it("joins with the token and a proof bound to this account's own key, never the secret", async () => {
    const { service, apiService } = setUp();
    apiService.send.mockResolvedValue({ organizationId: ORG, status: 1, automatic: false });
    const token = "dGhpcnR5LXR3byBieXRlcyBvZiBhIHRlc3QgdG9rZW4";
    const secret = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
    await service.join({ organizationId: ORG, token, secret });
    const [method, path, body, authed] = apiService.send.mock.calls[0];
    expect([method, path, authed]).toEqual(["POST", "/keykeeper/family-link/join", true]);
    expect(body).toEqual({
      organizationId: ORG,
      token,
      proof: await new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto).joinProof(
        secret,
        ORG,
        USER,
        ownPublicKey,
      ),
    });
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("asks the join page's question without signing in, and treats any refusal as a link that doesn't work", async () => {
    const { service, apiService } = setUp();
    apiService.send.mockRejectedValue(new Error(LINK_DOESNT_WORK));
    const parts = { organizationId: ORG, token: "t", secret: "s" };
    expect(await service.info(parts)).toBeNull();
    const [method, path, body, authed] = apiService.send.mock.calls[0];
    expect([method, path, authed]).toEqual(["POST", "/keykeeper/family-link/info", false]);
    expect(body).toEqual({ organizationId: ORG, token: "t" });
  });

  it("hides the card when the server says not found", async () => {
    const { service, apiService } = setUp();
    apiService.send.mockRejectedValue(new Error("Organization not found"));
    expect(await service.get(ORG)).toBeNull();
  });
});

describe("The words", () => {
  it("say who invited them, or just the family's name", () => {
    expect(invitedLine({ organizationName: "Rivera family", invitedBy: "Ana" })).toBe(
      "Ana invited you to join Rivera family.",
    );
    expect(invitedLine({ organizationName: "Rivera family", invitedBy: null })).toBe(
      "You're invited to join Rivera family.",
    );
  });

  it("say how each person who joined with the link got in", () => {
    expect(joinedHow({ automatic: true, status: 2 })).toBe("Let in automatically");
    expect(joinedHow({ automatic: false, status: 2 })).toBe("In");
    expect(joinedHow({ automatic: false, status: 1 })).toBe("Waiting for you on the Members page");
    expect(joinedHow({ automatic: true, status: 1 })).toBe("Being let in");
    expect(joinedHow({ automatic: true, status: -1 })).toBe("Access turned off");
  });

  it("say what to compare before confirming, and offer a legacy contact plainly", () => {
    expect(familyCompareLine("ben@example.test")).toContain(
      "Ask ben@example.test to read the phrase in Settings, My account.",
    );
    expect(LEGACY_CONTACT_SUGGESTION).toEqual({
      text: "Add a legacy contact: someone you trust who can ask for your vault if something happens to you.",
      add: "Add one",
      noThanks: "No thanks",
    });
  });
});
