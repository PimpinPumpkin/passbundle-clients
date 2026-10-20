import { webcrypto } from "node:crypto";

import { KeykeeperJoinSeals } from "./join-seals";
import * as vectors from "./join-seals.vectors.json";

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

  it("seals invitations by email, whatever its case", async () => {
    const joinKey = await seals.joinKey(orgKey);
    for (const v of vectors.inviteSeals) {
      expect(await seals.inviteSeal(joinKey, input.organizationId, v.email)).toBe(v.seal);
      expect(await seals.checkInviteSeal(v.seal, joinKey, input.organizationId, v.email)).toBe(
        true,
      );
    }
    expect(
      await seals.checkInviteSeal(
        vectors.inviteSeals[0].seal,
        joinKey,
        input.organizationId,
        "mallory@acmedental.example",
      ),
    ).toBe(false);
  });

  it("seals a staff member's place, distinct from an invitation", async () => {
    const joinKey = await seals.joinKey(orgKey);
    const v = vectors.staffSeal;
    expect(await seals.staffSeal(joinKey, input.organizationId, v.email)).toBe(v.seal);
    expect(await seals.checkStaffSeal(v.seal, joinKey, input.organizationId, v.email)).toBe(true);
    expect(await seals.checkInviteSeal(v.seal, joinKey, input.organizationId, v.email)).toBe(false);
  });

  it("seals the joining setting with its domains, in any order", async () => {
    const joinKey = await seals.joinKey(orgKey);
    for (const v of vectors.joiningSeals) {
      expect(await seals.joiningSeal(joinKey, input.organizationId, v.autoConfirm, v.domains)).toBe(
        v.seal,
      );
      expect(
        await seals.checkJoiningSeal(
          v.seal,
          joinKey,
          input.organizationId,
          v.autoConfirm,
          [...v.domains].reverse(),
        ),
      ).toBe(true);
    }
    // Approval turned off, or a domain added, without a new seal: no.
    const [, approval, withDomains] = vectors.joiningSeals;
    expect(
      await seals.checkJoiningSeal(approval.seal, joinKey, input.organizationId, true, []),
    ).toBe(false);
    expect(
      await seals.checkJoiningSeal(withDomains.seal, joinKey, input.organizationId, true, [
        ...withDomains.domains,
        "attacker.example",
      ]),
    ).toBe(false);
  });

  it("makes new join secrets in the install command's form", () => {
    const secret = seals.newJoinSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(seals.newJoinSecret()).not.toBe(secret);
  });
});
