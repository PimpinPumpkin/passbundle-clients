import { webcrypto } from "node:crypto";

import {
  compareJoiningMarks,
  joiningSealedAt,
  joiningSealSource,
  JoiningSource,
  KeykeeperJoinSeals,
  parseExpiringSeal,
  parseJoiningSeal,
  SEAL_LIFETIME_SECONDS,
  SEAL_MAX_AHEAD_SECONDS,
} from "./join-seals";
import * as vectors from "./join-seals.vectors.json";
import * as joining from "./joining-v2.vectors.json";
import * as joiningV3 from "./joining-v3.vectors.json";
import * as v2 from "./joins-v2.vectors.json";

const seals = new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto);
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const input = vectors.inputs;
const orgKey = bytes(input.organizationKey);
const userPublicKey = bytes(input.userPublicKey);

describe("Join seals, version 1, against the vectors", () => {
  it("makes the join key from the organization key", async () => {
    expect(Buffer.from(await seals.joinKey(orgKey)).toString("base64")).toBe(vectors.joinKey);
  });

  it("fingerprints the organization's public key", async () => {
    expect(await seals.fingerprint(bytes(input.organizationPublicKey))).toBe(
      vectors.organizationKeyFingerprint,
    );
  });

  it("proves a join knew the secret, for this person's key only", async () => {
    const proof = await seals.joinProof(
      input.joinSecret,
      input.organizationId,
      input.userId,
      userPublicKey,
    );
    expect(proof).toBe(vectors.joinProof);
    const check = (
      p: string,
      key = userPublicKey,
      user = input.userId,
      org = input.organizationId,
    ) => seals.checkJoinProof(p, input.joinSecret, org, user, key);
    expect(await check(proof)).toBe(true);
    // Another key, person, or organization: the server can't swap any of them.
    const otherKey = new Uint8Array(userPublicKey);
    otherKey[0] ^= 1;
    expect(await check(proof, otherKey)).toBe(false);
    expect(await check(proof, userPublicKey, "someone-else")).toBe(false);
    expect(await check(proof, userPublicKey, input.userId, "another-org")).toBe(false);
    expect(await check("")).toBe(false);
    expect(await check("not a seal")).toBe(false);
  });

  it("no longer takes version 1 invitation and staff seals, which never end", async () => {
    const joinKey = await seals.joinKey(orgKey);
    for (const v of vectors.inviteSeals) {
      expect(await seals.checkInviteSeal(v.seal, joinKey, input.organizationId, v.email)).toBe(
        false,
      );
    }
    const v = vectors.staffSeal;
    expect(await seals.checkStaffSeal(v.seal, joinKey, input.organizationId, v.email)).toBe(false);
  });

  it("no longer takes version 1 joining seals, which say nothing of where the setting comes from", async () => {
    const joinKey = await seals.joinKey(orgKey);
    for (const v of vectors.joiningSeals) {
      expect(
        await seals.checkJoiningSeal(
          v.seal,
          joinKey,
          input.organizationId,
          v.autoConfirm,
          v.domains,
        ),
      ).toBe(false);
    }
  });

  it("makes new join secrets in the install command's form", () => {
    const secret = seals.newJoinSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(seals.newJoinSecret()).not.toBe(secret);
  });
});

describe("Join seals, version 2, against the vectors", () => {
  const at = (seconds: number) => new Date(seconds * 1000);
  const org = v2.inputs.organizationId;
  const key = () => seals.joinKey(bytes(v2.inputs.organizationKey));

  it("uses the same join key, lifetime, and limit as the vectors", async () => {
    expect(Buffer.from(await key()).toString("base64")).toBe(v2.joinKey);
    expect(SEAL_LIFETIME_SECONDS).toBe(v2.lifetimeSeconds);
    expect(SEAL_MAX_AHEAD_SECONDS).toBe(v2.maxAheadSeconds);
  });

  it("makes invitation and staff seals as the vectors do", async () => {
    const joinKey = await key();
    for (const [kind, v] of [
      ["invite", v2.inviteSeal],
      ["staff", v2.staffSeal],
    ] as const) {
      expect(await seals.expiringSeal(kind, joinKey, org, v.email, v.expires, v.nonce)).toBe(
        v.seal,
      );
      expect(parseExpiringSeal(v.seal)).toEqual({ expires: v.expires, nonce: v.nonce });
    }
  });

  it("makes new seals that end after their lifetime, each with its own nonce", async () => {
    const joinKey = await key();
    const made = at(v2.inputs.madeAt);
    const a = await seals.inviteSeal(joinKey, org, "ana@acmedental.example", made);
    const b = await seals.inviteSeal(joinKey, org, "ana@acmedental.example", made);
    expect(parseExpiringSeal(a)!.expires).toBe(v2.inputs.madeAt + SEAL_LIFETIME_SECONDS);
    expect(parseExpiringSeal(a)!.nonce).not.toBe(parseExpiringSeal(b)!.nonce);
    expect(await seals.checkInviteSeal(a, joinKey, org, "ana@acmedental.example", made)).toBe(true);
  });

  it.each(v2.inviteChecks)("invitation: $why", async (c) => {
    expect(await seals.checkInviteSeal(c.seal, await key(), org, c.email, at(c.at))).toBe(
      c.vouches,
    );
  });

  it.each(v2.staffChecks)("staff: $why", async (c) => {
    expect(await seals.checkStaffSeal(c.seal, await key(), org, c.email, at(c.at))).toBe(c.vouches);
  });

  it("seals an MSP's client as the vectors do", async () => {
    expect(await seals.clientSeal(await key(), org, v2.clientSeal.mspId)).toBe(v2.clientSeal.seal);
  });

  it.each(v2.clientChecks)("client: $why", async (c) => {
    expect(await seals.checkClientSeal(c.seal, await key(), org, c.mspId)).toBe(c.vouches);
  });
});

describe("Joining seals, version 2, against the vectors", () => {
  const org = joining.inputs.organizationId;
  const joinKey = () => seals.joinKey(bytes(joining.inputs.organizationKey));

  it("makes the join key as version 1 does", async () => {
    expect(Buffer.from(await joinKey()).toString("base64")).toBe(joining.joinKey);
  });

  it("no longer takes version 2 joining seals, which say nothing of when they were sealed", async () => {
    for (const v of joining.seals) {
      expect(joiningSealSource(v.seal)).toBeNull();
      expect(
        await seals.checkJoiningSeal(
          v.seal,
          await joinKey(),
          org,
          v.autoConfirm,
          v.domains,
          v.source as JoiningSource,
        ),
      ).toBe(false);
    }
    for (const c of joining.checks) {
      expect(
        await seals.checkJoiningSeal(c.seal, await joinKey(), org, c.autoConfirm, c.domains),
      ).toBe(false);
    }
  });
});

describe("Joining seals, version 3, against the vectors", () => {
  const org = joiningV3.inputs.organizationId;
  const joinKey = () => seals.joinKey(bytes(joiningV3.inputs.organizationKey));
  const mark = (m: { sealedAt: number; nonce: string } | null) => m;

  it("makes the join key as version 1 does", async () => {
    expect(Buffer.from(await joinKey()).toString("base64")).toBe(joiningV3.joinKey);
  });

  it("seals the setting with its domains, in any order, where it comes from, and when", async () => {
    for (const v of joiningV3.seals) {
      const source = v.source as JoiningSource;
      expect(
        await seals.joiningSeal(
          await joinKey(),
          org,
          v.autoConfirm,
          v.domains,
          source,
          v.sealedAt,
          v.nonce,
        ),
      ).toBe(v.seal);
      expect(parseJoiningSeal(v.seal)).toEqual({ source, sealedAt: v.sealedAt, nonce: v.nonce });
      expect(joiningSealSource(v.seal)).toBe(source);
      expect(
        await seals.checkJoiningSeal(
          v.seal,
          await joinKey(),
          org,
          v.autoConfirm,
          [...v.domains].reverse(),
          source,
        ),
      ).toBe(true);
    }
  });

  it("gives each new seal its own nonce", async () => {
    const a = await seals.joiningSeal(await joinKey(), org, true, [], "own", 1_793_059_200);
    const b = await seals.joiningSeal(await joinKey(), org, true, [], "own", 1_793_059_200);
    expect(parseJoiningSeal(a)!.nonce).not.toBe(parseJoiningSeal(b)!.nonce);
    expect(await seals.checkJoiningSeal(a, await joinKey(), org, true, [], "own")).toBe(true);
    expect(await seals.checkJoiningSeal(b, await joinKey(), org, true, [], "own")).toBe(true);
  });

  it("refuses to seal a time it can't carry", async () => {
    for (const at of [0, -1, 1.5, 1_000_000_000_000]) {
      await expect(seals.joiningSeal(await joinKey(), org, true, [], "own", at)).rejects.toThrow();
    }
  });

  it.each(joiningV3.checks)("$why: vouches $vouches", async (c) => {
    expect(
      await seals.checkJoiningSeal(
        c.seal,
        await joinKey(),
        org,
        c.autoConfirm,
        c.domains,
        (c.source ?? undefined) as JoiningSource | undefined,
      ),
    ).toBe(c.vouches);
  });

  it.each(joiningV3.current)("current against the newest seen: $why", (c) => {
    const newest = mark(c.newestSeen);
    expect(newest == null || compareJoiningMarks(c.seal, newest) >= 0).toBe(c.current);
  });

  it.each(joiningV3.sealedAt)("sealed at: $why", (c) => {
    expect(joiningSealedAt(new Date(c.now * 1000), c.newestSeen)).toBe(c.sealedAt);
    // Part of a second on the clock doesn't count.
    expect(joiningSealedAt(new Date(c.now * 1000 + 999), c.newestSeen)).toBe(c.sealedAt);
  });

  it("reads no source or time from anything but a version 3 joining seal", () => {
    expect(parseJoiningSeal(null)).toBeNull();
    expect(joiningSealSource(vectors.joiningSeals[0].seal)).toBeNull();
    expect(joiningSealSource(joining.seals[0].seal)).toBeNull();
    expect(joiningSealSource(v2.inviteSeal.seal)).toBeNull();
  });
});
