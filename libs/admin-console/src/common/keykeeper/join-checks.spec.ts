import { webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom } from "rxjs";

import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import { KEYKEEPER_USED_SEALS, KeykeeperJoinChecks, MAX_ON_ITS_OWN_PER_DAY } from "./join-checks";
import { KeykeeperJoinSeals, parseExpiringSeal } from "./join-seals";
import { PendingMember } from "./msp-types";

const USER = "admin-user" as UserId;
const ORG = "8f9a7c1e-3b2d-4e5f-9a8b-7c6d5e4f3a2b";
const orgKey = new SymmetricCryptoKey(new Uint8Array(64).map((_, i) => i)) as OrgKey;
const seals = new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto);
const SECRET = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const ENCRYPTED_SECRET = "2.c2VjcmV0|c2VjcmV0|c2VjcmV0";
const publicKey = (n: number) => Buffer.from(new Uint8Array(48).fill(n)).toString("base64");
/** When these checks run; seals are made at this moment too, unless a test says otherwise. */
const NOW = new Date("2026-10-20T09:00:00Z");
const DAY = 86_400_000;

function setUp() {
  const keyService = mock<KeyService>();
  keyService.orgKeys$.mockReturnValue(
    new BehaviorSubject({ [ORG]: orgKey } as Record<OrganizationId, OrgKey>),
  );
  const encryptService = mock<EncryptService>();
  encryptService.decryptString.mockImplementation(async (enc: EncString) => {
    if (enc.encryptedString !== ENCRYPTED_SECRET) {
      throw new Error("Not encrypted with this key");
    }
    return SECRET;
  });
  const stateProvider = new FakeStateProvider(mockAccountServiceWith(USER));
  const checks = new KeykeeperJoinChecks(keyService, encryptService, stateProvider, seals);
  return { checks, keyService, stateProvider };
}

const joinKey = () => seals.joinKey(orgKey.toEncoded());

async function sealedJoining(autoConfirm = true, domains: string[] = []) {
  return {
    autoConfirm,
    domains,
    seal: await seals.joiningSeal(await joinKey(), ORG, autoConfirm, domains),
  };
}

function waiting(email: string, more: Partial<PendingMember> = {}): PendingMember {
  return {
    organizationId: ORG,
    memberId: `member-${email}`,
    userId: `user-${email}`,
    email,
    publicKey: publicKey(1),
    autoConfirm: true,
    ...more,
  };
}

const invited = async (email: string, more: Partial<PendingMember> = {}, made = NOW) =>
  waiting(email, {
    joining: await sealedJoining(),
    inviteSeal: await seals.inviteSeal(await joinKey(), ORG, email, made),
    ...more,
  });

const emails = (list: PendingMember[]) => list.map((p) => p.email);

describe("Who an app lets in on its own", () => {
  it("someone an admin invited, in an organization whose setting is sealed", async () => {
    const { checks } = setUp();
    const ana = await invited("ana@acmedental.example");
    expect(emails(await checks.onItsOwn(USER, [ana], NOW))).toEqual(["ana@acmedental.example"]);
  });

  it("nobody the server made up, or whose invitation was for someone else", async () => {
    const { checks } = setUp();
    const madeUp = waiting("mallory@evil.example", { joining: await sealedJoining() });
    const otherSeal = await invited("ana@acmedental.example");
    otherSeal.email = "mallory@evil.example";
    expect(await checks.onItsOwn(USER, [madeUp, otherSeal], NOW)).toEqual([]);
  });

  it("nobody when approval was turned off without a seal, or the server says approval", async () => {
    const { checks } = setUp();
    const approval = await invited("ana@acmedental.example", {
      joining: { ...(await sealedJoining(false)), autoConfirm: true },
    });
    const unsealed = await invited("ben@acmedental.example", {
      joining: { autoConfirm: true, domains: [], seal: null },
    });
    const serverSaysApproval = await invited("cy@acmedental.example", { autoConfirm: false });
    const olderServer = waiting("dee@acmedental.example");
    expect(
      await checks.onItsOwn(USER, [approval, unsealed, serverSaysApproval, olderServer], NOW),
    ).toEqual([]);
  });

  it("an install command join only with its proof for this very key, and with email domains", async () => {
    const { checks } = setUp();
    const proof = await seals.joinProof(
      SECRET,
      ORG,
      "user-frontdesk@acmedental.example",
      Buffer.from(publicKey(1), "base64"),
    );
    const join = async (more: Partial<PendingMember>) =>
      waiting("frontdesk@acmedental.example", {
        joining: await sealedJoining(true, ["acmedental.example"]),
        joinProof: proof,
        enrollmentSecret: ENCRYPTED_SECRET,
        ...more,
      });
    expect(emails(await checks.onItsOwn(USER, [await join({})], NOW))).toEqual([
      "frontdesk@acmedental.example",
    ]);
    // The server swapped in a key of its own.
    expect(await checks.onItsOwn(USER, [await join({ publicKey: publicKey(2) })], NOW)).toEqual([]);
    // No domains: anyone with the command could have made the proof.
    expect(
      await checks.onItsOwn(USER, [await join({ joining: await sealedJoining() })], NOW),
    ).toEqual([]);
    // A secret that isn't this organization's.
    expect(
      await checks.onItsOwn(
        USER,
        [await join({ enrollmentSecret: "2.b3RoZXI=|b3RoZXI=|b3RoZXI=" })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("MSP staff only with a staff seal", async () => {
    const { checks } = setUp();
    const email = "tech@northwind.example";
    const staffSeal = await seals.staffSeal(await joinKey(), ORG, email, NOW);
    const sealed = waiting(email, { fromMsp: true, joining: await sealedJoining(), staffSeal });
    const inviteOnly = await invited(email, { fromMsp: true });
    expect(emails(await checks.onItsOwn(USER, [sealed], NOW))).toEqual([email]);
    expect(await checks.onItsOwn(USER, [inviteOnly], NOW)).toEqual([]);
  });

  it(`at most ${MAX_ON_ITS_OWN_PER_DAY} a day for each organization, then again the next day`, async () => {
    const { checks } = setUp();
    const many = await Promise.all(
      Array.from({ length: MAX_ON_ITS_OWN_PER_DAY + 3 }, (_, i) =>
        invited(`p${i}@acmedental.example`),
      ),
    );
    const today = NOW;
    expect(await checks.onItsOwn(USER, many, today)).toHaveLength(MAX_ON_ITS_OWN_PER_DAY);
    expect(await checks.onItsOwn(USER, many.slice(-3), today)).toEqual([]);
    const tomorrow = new Date("2026-10-21T09:00:00Z");
    expect(await checks.onItsOwn(USER, many.slice(-3), tomorrow)).toHaveLength(3);
  });

  it("nobody who must turn on two-step login first, and they don't use up the day's limit", async () => {
    const { checks } = setUp();
    const today = NOW;
    const waitingForTwoStep = await invited("bo@acmedental.example", { needsTwoStep: true });
    // Every run of the background work sees them again until they turn it on.
    for (let run = 0; run < MAX_ON_ITS_OWN_PER_DAY + 5; run++) {
      expect(await checks.onItsOwn(USER, [waitingForTwoStep], today)).toEqual([]);
    }
    const ana = await invited("ana@acmedental.example");
    expect(emails(await checks.onItsOwn(USER, [ana], today))).toEqual(["ana@acmedental.example"]);
  });
});

describe("Seals that end, and are used once", () => {
  it("an invitation's seal lets someone in only until it ends", async () => {
    const { checks } = setUp();
    const ana = await invited("ana@acmedental.example");
    expect(await checks.onItsOwn(USER, [ana], new Date(NOW.getTime() + 15 * DAY))).toEqual([]);
    expect(emails(await checks.onItsOwn(USER, [ana], new Date(NOW.getTime() + 13 * DAY)))).toEqual([
      "ana@acmedental.example",
    ]);
  });

  it("a staff seal too", async () => {
    const { checks } = setUp();
    const email = "tech@northwind.example";
    const staffSeal = await seals.staffSeal(await joinKey(), ORG, email, NOW);
    const tech = waiting(email, { fromMsp: true, joining: await sealedJoining(), staffSeal });
    expect(await checks.onItsOwn(USER, [tech], new Date(NOW.getTime() + 15 * DAY))).toEqual([]);
  });

  it("nobody on a version 1 seal, which never ends", async () => {
    const { checks } = setUp();
    const v1 = Buffer.alloc(32, 7).toString("base64");
    const ana = await invited("ana@acmedental.example", { inviteSeal: v1 });
    expect(await checks.onItsOwn(USER, [ana], NOW)).toEqual([]);
  });

  it("nobody twice on one seal on this device, whatever the server says later", async () => {
    const { checks } = setUp();
    const ana = await invited("ana@acmedental.example");
    expect(emails(await checks.onItsOwn(USER, [ana], NOW))).toEqual(["ana@acmedental.example"]);
    await checks.markLetIn(USER, ana, NOW);
    // The server shows the same invitation again, for a key of its own.
    const again = { ...ana, memberId: "member-again", publicKey: publicKey(9) };
    expect(await checks.onItsOwn(USER, [again], new Date(NOW.getTime() + DAY))).toEqual([]);
    // A new invitation, with a new seal, is another matter.
    const reinvited = await invited("ana@acmedental.example", {}, new Date(NOW.getTime() + DAY));
    expect(emails(await checks.onItsOwn(USER, [reinvited], new Date(NOW.getTime() + DAY)))).toEqual(
      ["ana@acmedental.example"],
    );
  });

  it("forgets a used seal once it has ended", async () => {
    const { checks, stateProvider } = setUp();
    const ana = await invited("ana@acmedental.example");
    const ben = await invited("ben@acmedental.example", {}, new Date(NOW.getTime() + 20 * DAY));
    await checks.markLetIn(USER, ana, NOW);
    await checks.markLetIn(USER, ben, new Date(NOW.getTime() + 20 * DAY));
    const used = await firstValueFrom(stateProvider.getUser(USER, KEYKEEPER_USED_SEALS).state$);
    // Only ben's seal is still remembered: ana's ended after 14 days.
    expect(Object.keys(used ?? {})).toEqual([`${ORG}/${parseExpiringSeal(ben.inviteSeal)!.nonce}`]);
  });
});

describe("Which of an MSP's clients this device trusts", () => {
  const MSP = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
  const client = async (id: string, sealFor = MSP, sealedOrg = id) => ({
    id,
    seal: await seals.clientSeal(await joinKey(), sealedOrg, sealFor),
  });

  it("those with this MSP's client seal, made with their key", async () => {
    const { checks } = setUp();
    const real = await client(ORG);
    expect(await checks.trustedClients(USER, MSP, [real])).toEqual([real]);
  });

  it("never an organization without one, with another MSP's, or with another organization's", async () => {
    const { checks, keyService } = setUp();
    const FAMILY = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
    keyService.orgKeys$.mockReturnValue(
      new BehaviorSubject({ [ORG]: orgKey, [FAMILY]: orgKey } as Record<OrganizationId, OrgKey>),
    );
    expect(
      await checks.trustedClients(USER, MSP, [
        { id: ORG, seal: null },
        await client(ORG, "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a"),
        await client(FAMILY, MSP, ORG),
      ]),
    ).toEqual([]);
  });

  it("never one whose key this person doesn't hold", async () => {
    const { checks, keyService } = setUp();
    const real = await client(ORG);
    keyService.orgKeys$.mockReturnValue(new BehaviorSubject({} as Record<OrganizationId, OrgKey>));
    expect(await checks.trustedClients(USER, MSP, [real])).toEqual([]);
  });
});
