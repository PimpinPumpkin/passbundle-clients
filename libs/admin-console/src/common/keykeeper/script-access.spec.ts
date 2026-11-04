import { webcrypto } from "node:crypto";

import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";

import {
  CopiedItem,
  copyOf,
  KeykeeperScriptCopies,
  KeykeeperScriptKeys,
  ScriptFields,
  sealedExpiry,
  sealsStillLive,
} from "./script-access";
import { nodeEncrypt } from "./script-access.test-helper";
import * as vectors from "./script-access.vectors.json";
import * as grantsV2 from "./script-grants-v2.vectors.json";
import * as grants from "./script-grants-v3.vectors.json";

const keys = new KeykeeperScriptKeys(webcrypto.subtle as unknown as SubtleCrypto);
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const seed = bytes(vectors.inputs.seed);
const tokenId = vectors.inputs.tokenId;

const copies = new KeykeeperScriptCopies(nodeEncrypt);
const orgKey = new SymmetricCryptoKey(bytes(vectors.inputs.organizationKey));

describe("Script access keys, version 1, against the vectors", () => {
  it("writes and reads the token string", () => {
    expect(keys.tokenString(tokenId, seed)).toBe(vectors.tokenString);
    const parsed = keys.parseTokenString(vectors.tokenString)!;
    expect(parsed.id).toBe(tokenId);
    expect(Buffer.from(parsed.seed).toString("base64")).toBe(vectors.inputs.seed);
    expect(keys.parseTokenString("pbs1_short_x")).toBeNull();
    expect(keys.parseTokenString(vectors.tokenString.replace("pbs1", "pbs2"))).toBeNull();
  });

  it("derives the auth secret, its hash, the header, and the token key from the seed", async () => {
    expect(Buffer.from(await keys.authSecret(seed)).toString("base64url")).toBe(vectors.authSecret);
    expect(await keys.authHash(seed)).toBe(vectors.authHash);
    expect(await keys.authorization(tokenId, seed)).toBe(vectors.authorization);
    expect(Buffer.from(await keys.tokenKey(seed)).toString("base64")).toBe(vectors.tokenKey);
  });

  it("opens the copy for its own token and item, and refuses the rest", async () => {
    const tokenKey = new SymmetricCryptoKey(bytes(vectors.tokenKey));
    const opened = await copies.decryptCopy(
      vectors.copy.encString,
      tokenKey,
      tokenId,
      vectors.inputs.itemId,
    );
    expect(opened).toEqual(JSON.parse(vectors.copy.plaintext));
    for (const bad of vectors.refused) {
      await expect(
        copies.decryptCopy(bad.encString, tokenKey, tokenId, vectors.inputs.itemId),
      ).rejects.toThrow();
    }
    for (const swapped of vectors.mismatched) {
      await expect(
        copies.decryptCopy(swapped.encString, tokenKey, tokenId, vectors.inputs.itemId),
      ).rejects.toThrow("another token or item");
    }
  });
});

describe("Script grant seals, version 3, against the vectors", () => {
  const itemId = grants.inputs.itemId;
  const at = (seconds: number) => new Date(seconds * 1000);

  it("opens the sealed token key and spec for their own token and item, with when the token ends", async () => {
    const tokenKey = await copies.unsealTokenKey(grants.sealedTokenKey.encString, orgKey, tokenId);
    expect(Buffer.from(tokenKey.key.toEncoded()).toString("base64")).toBe(grants.tokenKey);
    expect(tokenKey.expires).toBe(grants.expires);
    expect(await copies.unsealSpec(grants.sealedSpec.encString, orgKey, tokenId, itemId)).toEqual(
      JSON.parse(grants.sealedSpec.plaintext),
    );
    // Ids compare without regard to case.
    await expect(
      copies.unsealSpec(grants.sealedSpec.encString, orgKey, tokenId.toUpperCase(), itemId),
    ).resolves.toBeTruthy();
  });

  it.each(grants.checks)("$why: refreshes $refreshes", async (c) => {
    const refreshes = async () => {
      const key = await copies.unsealTokenKey(c.sealedKey, orgKey, tokenId);
      const spec = await copies.unsealSpec(c.sealedSpec, orgKey, tokenId, itemId);
      return sealsStillLive(key, spec, at(c.at));
    };
    expect(await refreshes().catch(() => false)).toBe(c.refreshes);
  });

  it("refuses the version 1 seals, which name no token or item", async () => {
    await expect(
      copies.unsealTokenKey(vectors.sealedTokenKey.encString, orgKey, tokenId),
    ).rejects.toThrow("this script token's key");
    await expect(
      copies.unsealSpec(vectors.sealedSpec.encString, orgKey, tokenId, itemId),
    ).rejects.toThrow("this grant's spec");
  });

  it("refuses every version 2 seal, which says nothing of when the token ends", async () => {
    const v2 = [
      { sealedKey: grantsV2.sealedTokenKey.encString, sealedSpec: grantsV2.sealedSpec.encString },
      ...grantsV2.refused,
    ];
    for (const r of v2) {
      await expect(copies.unsealTokenKey(r.sealedKey, orgKey, tokenId)).rejects.toThrow();
    }
    await expect(
      copies.unsealSpec(grantsV2.sealedSpec.encString, orgKey, tokenId, itemId),
    ).rejects.toThrow("this grant's spec");
  });

  it("seals what it makes so the vectors' readers open it, and only for that token and item", async () => {
    const tokenKey = await keys.tokenKey(seed);
    const expires = sealedExpiry(new Date(grants.expires * 1000).toISOString());
    expect(expires).toBe(grants.expires);
    const sealedKey = await copies.sealTokenKey(tokenId, expires, tokenKey, orgKey);
    const reopened = await copies.unsealTokenKey(sealedKey, orgKey, tokenId);
    expect(Buffer.from(reopened.key.toEncoded()).toString("base64")).toBe(grants.tokenKey);
    expect(reopened.expires).toBe(grants.expires);
    await expect(copies.unsealTokenKey(sealedKey, orgKey, "another-token")).rejects.toThrow();

    const fields: ScriptFields = {
      username: true,
      password: true,
      totp: false,
      fields: ["Break-glass PIN"],
    };
    const sealedSpec = await copies.sealSpec(tokenId, itemId, expires, fields, orgKey);
    expect(await copies.unsealSpec(sealedSpec, orgKey, tokenId, itemId)).toEqual(
      JSON.parse(grants.sealedSpec.plaintext),
    );
    await expect(copies.unsealSpec(sealedSpec, orgKey, tokenId, "another-item")).rejects.toThrow();
    await expect(copies.unsealSpec(sealedSpec, orgKey, "another-token", itemId)).rejects.toThrow();
  });
});

describe("copyOf", () => {
  const item: CopiedItem = {
    id: "0d1e2f3a-4b5c-4d6e-8f70-819a2b3c4d5e",
    name: "Domain admin",
    revisionDate: new Date("2026-10-20T18:00:00.000Z"),
    login: {
      username: "admin@contoso.example",
      password: "not-a-real-password-1",
      totp: "JBSWY3DPEHPK3PXP",
    },
    fields: [
      { name: "Break-glass PIN", value: "0000" },
      { name: "Not granted", value: "secret" },
    ],
  };

  it("copies only what the spec asks for, with the token, item, and revision", () => {
    const spec: ScriptFields = {
      username: true,
      password: true,
      totp: false,
      fields: ["Break-glass PIN"],
    };
    expect(copyOf(tokenId, item, spec)).toEqual(JSON.parse(vectors.copy.plaintext));
  });

  it("leaves out what the item doesn't have", () => {
    const spec: ScriptFields = {
      username: false,
      password: false,
      totp: true,
      fields: ["Missing"],
    };
    const noTotp: CopiedItem = { ...item, login: { ...item.login, totp: null } };
    expect(copyOf(tokenId, noTotp, spec)).toEqual({
      v: 1,
      token: tokenId,
      item: item.id,
      revision: "2026-10-20T18:00:00.000Z",
      name: "Domain admin",
      fields: {},
    });
  });
});
