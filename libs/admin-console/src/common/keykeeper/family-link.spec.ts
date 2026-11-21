import { webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom } from "rxjs";

import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import {
  FamilyLinkSettings,
  familyLinkAddress,
  KEYKEEPER_FAMILY_LINK_SEEN,
  KeykeeperFamilyLinks,
  readFamilyLink,
} from "./family-link";
import { KEYKEEPER_USED_SEALS, KeykeeperJoinChecks } from "./join-checks";
import { KeykeeperJoinSeals } from "./join-seals";
import { PendingMember } from "./msp-types";

const USER = "owner-user" as UserId;
const ORG = "4c2f8a1e-7b3d-4e5f-9a8b-1c2d3e4f5a6b";
const OTHER_ORG = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const familyKey = new SymmetricCryptoKey(new Uint8Array(64).map((_, i) => i)) as OrgKey;
const otherKey = new SymmetricCryptoKey(new Uint8Array(64).map((_, i) => 255 - i)) as OrgKey;
const seals = new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto);
const TOKEN = "dGhpcnR5LXR3byBieXRlcyBvZiBhIHRlc3QgdG9rZW4";
const SECRET = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const NONCE = "AAAAAAAAAAAAAAAAAAAAAA";
const NOW = new Date("2026-11-19T09:00:00Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const DAY = 86_400;
const publicKey = (n: number) => Buffer.from(new Uint8Array(48).fill(n)).toString("base64");

/**
 * Stands in for upstream's EncryptService: what it encrypts opens only with
 * the same key, and the server (the tests) can't make one without it.
 */
function fakeEncryptService() {
  const encryptService = mock<EncryptService>();
  const tag = (key: SymmetricCryptoKey) =>
    Buffer.from(key.toEncoded().slice(0, 4)).toString("base64");
  encryptService.encryptString.mockImplementation(async (plain: string, key) => {
    const data = Buffer.from(plain).toString("base64");
    return new EncString(`2.${tag(key as SymmetricCryptoKey)}|${data}|bWFj`);
  });
  encryptService.decryptString.mockImplementation(async (enc: EncString, key) => {
    const [iv, data] = (enc.encryptedString as string).slice(2).split("|");
    if (iv !== tag(key as SymmetricCryptoKey)) {
      throw new Error("Not encrypted with this key");
    }
    return Buffer.from(data, "base64").toString();
  });
  return encryptService;
}

function setUp() {
  const stateProvider = new FakeStateProvider(mockAccountServiceWith(USER));
  const encryptService = fakeEncryptService();
  const links = new KeykeeperFamilyLinks(encryptService, stateProvider, seals);
  const keyService = mock<KeyService>();
  keyService.orgKeys$.mockReturnValue(
    new BehaviorSubject({ [ORG]: familyKey } as Record<OrganizationId, OrgKey>),
  );
  const checks = new KeykeeperJoinChecks(keyService, encryptService, stateProvider, seals);
  return { links, checks, stateProvider };
}

function settings(more: Partial<FamilyLinkSettings> = {}): FamilyLinkSettings {
  return {
    v: 1,
    organizationId: ORG,
    on: true,
    token: TOKEN,
    secret: SECRET,
    automatic: true,
    expiresAt: SECONDS + 7 * DAY,
    sealedAt: SECONDS,
    nonce: NONCE,
    ...more,
  };
}

const off = (sealedAt: number): FamilyLinkSettings =>
  settings({ on: false, token: null, secret: null, automatic: false, expiresAt: null, sealedAt });

/** Someone the server lists as having joined with the family's link. */
async function linkJoiner(
  links: KeykeeperFamilyLinks,
  email: string,
  linkSettings: FamilyLinkSettings,
  more: Partial<PendingMember> = {},
): Promise<PendingMember> {
  const userId = `user-${email}`;
  return {
    organizationId: ORG,
    memberId: `member-${email}`,
    userId,
    email,
    publicKey: publicKey(1),
    autoConfirm: true,
    familyLink: {
      sealed: await links.seal(linkSettings, familyKey),
      joinProof: await seals.joinProof(SECRET, ORG, userId, Buffer.from(publicKey(1), "base64")),
    },
    ...more,
  };
}

describe("The family's invite link", () => {
  it("is the join page's address with the family, the token, and the join secret", () => {
    const address = familyLinkAddress("https://vault.example.test/", {
      organizationId: ORG,
      token: TOKEN,
      secret: SECRET,
    });
    expect(address).toBe(
      `https://vault.example.test/#/family-join?o=${ORG}&t=${TOKEN}&s=${SECRET}`,
    );
    const query = Object.fromEntries(new URLSearchParams(address.split("?")[1]));
    expect(readFamilyLink(query)).toEqual({ organizationId: ORG, token: TOKEN, secret: SECRET });
  });

  it("takes only a link whose three parts look right", () => {
    for (const query of [
      {},
      { o: ORG, t: TOKEN },
      { o: "not-an-id", t: TOKEN, s: SECRET },
      { o: ORG, t: `${TOKEN}=`, s: SECRET },
      { o: ORG, t: TOKEN, s: "short" },
      { o: ORG, t: TOKEN, s: [SECRET] },
    ]) {
      expect(readFamilyLink(query)).toBeNull();
    }
  });

  it("keeps its settings encrypted with the family's key, for this family only", async () => {
    const { links } = setUp();
    const sealed = await links.seal(settings(), familyKey);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain(SECRET);
    expect(await links.open(sealed, familyKey, ORG)).toEqual(settings());
    expect(await links.open(sealed, otherKey, ORG)).toBeNull();
    expect(await links.open(sealed, familyKey, OTHER_ORG)).toBeNull();
    expect(await links.open(null, familyKey, ORG)).toBeNull();
    expect(await links.open(await links.seal(off(SECONDS), familyKey), familyKey, ORG)).toEqual(
      off(SECONDS),
    );
  });

  it("opens only settings that are exactly a link's", async () => {
    const { links } = setUp();
    const encryptService = fakeEncryptService();
    const sealedJson = async (json: string) =>
      (await encryptService.encryptString(json, familyKey)).encryptedString as string;
    for (const bad of [
      "not json",
      JSON.stringify({ ...settings(), v: 2 }),
      JSON.stringify({ ...settings(), token: null }),
      JSON.stringify({ ...settings(), secret: "short" }),
      JSON.stringify({ ...settings(), expiresAt: null }),
      JSON.stringify({ ...settings(), nonce: "x" }),
      JSON.stringify({ ...off(SECONDS), automatic: true }),
      JSON.stringify({ ...off(SECONDS), token: TOKEN }),
    ]) {
      expect(await links.open(await sealedJson(bad), familyKey, ORG)).toBeNull();
    }
  });

  it("seals a change just after the newest settings this device has seen", async () => {
    const { links } = setUp();
    expect(await links.sealedAt(USER, ORG, NOW)).toBe(SECONDS);
    await links.current(USER, settings({ sealedAt: SECONDS + 100 }));
    expect(await links.sealedAt(USER, ORG, NOW)).toBe(SECONDS + 101);
    expect(KEYKEEPER_FAMILY_LINK_SEEN.clearOn).toEqual([]);
  });
});

describe("Who an app lets in on its own with a family's link", () => {
  it("someone who joined while it's automatic, with a proof for this very key", async () => {
    const { links, checks } = setUp();
    const ana = await linkJoiner(links, "ana@family.example", settings());
    expect(await links.vouches(USER, ana, familyKey, NOW)).toBe(true);
    expect((await checks.onItsOwn(USER, [ana], NOW)).map((p) => p.email)).toEqual([
      "ana@family.example",
    ]);
  });

  it("nobody whose key isn't the one the proof was made for, or with no proof", async () => {
    const { links } = setUp();
    const swapped = await linkJoiner(links, "ana@family.example", settings(), {
      publicKey: publicKey(2),
    });
    const noProof = await linkJoiner(links, "ben@family.example", settings());
    noProof.familyLink = { ...noProof.familyLink!, joinProof: null };
    const otherSecret = await linkJoiner(links, "cy@family.example", settings());
    otherSecret.familyLink!.joinProof = await seals.joinProof(
      TOKEN,
      ORG,
      otherSecret.userId,
      Buffer.from(publicKey(1), "base64"),
    );
    for (const p of [swapped, noProof, otherSecret]) {
      expect(await links.vouches(USER, p, familyKey, NOW)).toBe(false);
    }
  });

  it("nobody while approval is one tap, after the link ends, or with settings it can't open", async () => {
    const { links } = setUp();
    const oneTap = await linkJoiner(links, "ana@family.example", settings({ automatic: false }));
    const ended = await linkJoiner(links, "ben@family.example", settings({ expiresAt: SECONDS }));
    const unsealed = await linkJoiner(links, "cy@family.example", settings());
    unsealed.familyLink!.sealed = null;
    const otherFamily = await linkJoiner(links, "dee@family.example", settings());
    otherFamily.familyLink!.sealed = await links.seal(settings(), otherKey);
    for (const p of [oneTap, ended, unsealed, otherFamily]) {
      expect(await links.vouches(USER, p, familyKey, NOW)).toBe(false);
    }
  });

  it("never on older settings than the newest this device has seen", async () => {
    const { links, checks } = setUp();
    const automatic = settings({ sealedAt: SECONDS - 100 });
    // The owner chose one tap since; this device saw it on its background run.
    await checks.learnJoining(USER, [
      {
        organizationId: ORG,
        autoConfirm: true,
        domains: [],
        seal: null,
        familyLink: await links.seal(settings({ automatic: false, sealedAt: SECONDS }), familyKey),
      },
    ]);
    const replayed = await linkJoiner(links, "ana@family.example", automatic);
    expect(await links.vouches(USER, replayed, familyKey, NOW)).toBe(false);

    // Turned off since: an older live link is refused too.
    await links.current(USER, off(SECONDS + 10));
    const older = await linkJoiner(
      links,
      "ben@family.example",
      settings({ sealedAt: SECONDS + 5 }),
    );
    expect(await links.vouches(USER, older, familyKey, NOW)).toBe(false);

    // Newer settings that are automatic again let people in.
    const newer = await linkJoiner(
      links,
      "cy@family.example",
      settings({ sealedAt: SECONDS + 20 }),
    );
    expect(await links.vouches(USER, newer, familyKey, NOW)).toBe(true);
  });

  it("on the link's terms alone: not the organization's joining setting, nor an invitation's seal", async () => {
    const { links, checks } = setUp();
    const joinKey = await seals.joinKey(familyKey.toEncoded());
    const email = "ana@family.example";
    // One tap on the link, with a joining setting and an invitation seal
    // that would let her in if they counted.
    const ana = await linkJoiner(links, email, settings({ automatic: false }), {
      joining: {
        autoConfirm: true,
        domains: [],
        seal: await seals.joiningSeal(joinKey, ORG, true, [], "default", SECONDS, NONCE),
      },
      inviteSeal: await seals.inviteSeal(joinKey, ORG, email, NOW),
    });
    expect(await checks.onItsOwn(USER, [ana], NOW)).toEqual([]);
  });

  it("nobody the server says waits for a tap, whatever the link says", async () => {
    const { links, checks } = setUp();
    const ana = await linkJoiner(links, "ana@family.example", settings(), { autoConfirm: false });
    expect(await checks.onItsOwn(USER, [ana], NOW)).toEqual([]);
  });

  it("uses no seal, so nothing is remembered as used", async () => {
    const { links, checks, stateProvider } = setUp();
    const ana = await linkJoiner(links, "ana@family.example", settings());
    await checks.markLetIn(USER, ana, NOW);
    expect(
      (await firstValueFrom(stateProvider.getUser(USER, KEYKEEPER_USED_SEALS).state$)) ?? {},
    ).toEqual({});
  });
});
