import { webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperJoinChecks, MAX_ON_ITS_OWN_PER_DAY } from "./join-checks";
import { KeykeeperJoinSeals } from "./join-seals";
import { PendingMember } from "./msp-types";

const USER = "admin-user" as UserId;
const ORG = "8f9a7c1e-3b2d-4e5f-9a8b-7c6d5e4f3a2b";
const orgKey = new SymmetricCryptoKey(new Uint8Array(64).map((_, i) => i)) as OrgKey;
const seals = new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto);
const SECRET = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const ENCRYPTED_SECRET = "2.c2VjcmV0|c2VjcmV0|c2VjcmV0";
const publicKey = (n: number) => Buffer.from(new Uint8Array(48).fill(n)).toString("base64");

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
  return { checks };
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

const invited = async (email: string, more: Partial<PendingMember> = {}) =>
  waiting(email, {
    joining: await sealedJoining(),
    inviteSeal: await seals.inviteSeal(await joinKey(), ORG, email),
    ...more,
  });

const emails = (list: PendingMember[]) => list.map((p) => p.email);

describe("Who an app lets in on its own", () => {
  it("someone an admin invited, in an organization whose setting is sealed", async () => {
    const { checks } = setUp();
    const ana = await invited("ana@acmedental.example");
    expect(emails(await checks.onItsOwn(USER, [ana]))).toEqual(["ana@acmedental.example"]);
  });

  it("nobody the server made up, or whose invitation was for someone else", async () => {
    const { checks } = setUp();
    const madeUp = waiting("mallory@evil.example", { joining: await sealedJoining() });
    const otherSeal = await invited("ana@acmedental.example");
    otherSeal.email = "mallory@evil.example";
    expect(await checks.onItsOwn(USER, [madeUp, otherSeal])).toEqual([]);
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
      await checks.onItsOwn(USER, [approval, unsealed, serverSaysApproval, olderServer]),
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
    expect(emails(await checks.onItsOwn(USER, [await join({})]))).toEqual([
      "frontdesk@acmedental.example",
    ]);
    // The server swapped in a key of its own.
    expect(await checks.onItsOwn(USER, [await join({ publicKey: publicKey(2) })])).toEqual([]);
    // No domains: anyone with the command could have made the proof.
    expect(await checks.onItsOwn(USER, [await join({ joining: await sealedJoining() })])).toEqual(
      [],
    );
    // A secret that isn't this organization's.
    expect(
      await checks.onItsOwn(USER, [
        await join({ enrollmentSecret: "2.b3RoZXI=|b3RoZXI=|b3RoZXI=" }),
      ]),
    ).toEqual([]);
  });

  it("MSP staff only with a staff seal", async () => {
    const { checks } = setUp();
    const email = "tech@northwind.example";
    const staffSeal = await seals.staffSeal(await joinKey(), ORG, email);
    const sealed = waiting(email, { fromMsp: true, joining: await sealedJoining(), staffSeal });
    const inviteOnly = await invited(email, { fromMsp: true });
    expect(emails(await checks.onItsOwn(USER, [sealed]))).toEqual([email]);
    expect(await checks.onItsOwn(USER, [inviteOnly])).toEqual([]);
  });

  it(`at most ${MAX_ON_ITS_OWN_PER_DAY} a day for each organization, then again the next day`, async () => {
    const { checks } = setUp();
    const many = await Promise.all(
      Array.from({ length: MAX_ON_ITS_OWN_PER_DAY + 3 }, (_, i) =>
        invited(`p${i}@acmedental.example`),
      ),
    );
    const today = new Date("2026-10-20T09:00:00Z");
    expect(await checks.onItsOwn(USER, many, today)).toHaveLength(MAX_ON_ITS_OWN_PER_DAY);
    expect(await checks.onItsOwn(USER, many.slice(-3), today)).toEqual([]);
    const tomorrow = new Date("2026-10-21T09:00:00Z");
    expect(await checks.onItsOwn(USER, many.slice(-3), tomorrow)).toHaveLength(3);
  });
});
