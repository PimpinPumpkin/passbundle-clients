import { webcrypto } from "node:crypto";

import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";

import {
  CopiedItem,
  copyOf,
  KeykeeperScriptCopies,
  KeykeeperScriptKeys,
  ScriptSpec,
} from "./script-access";
import { nodeEncrypt } from "./script-access.test-helper";
import * as vectors from "./script-access.vectors.json";

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

  it("opens the sealed token key and spec with the organization key", async () => {
    const tokenKey = await copies.unsealTokenKey(vectors.sealedTokenKey.encString, orgKey);
    expect(Buffer.from(tokenKey.toEncoded()).toString("base64")).toBe(vectors.tokenKey);
    expect(await copies.unsealSpec(vectors.sealedSpec.encString, orgKey)).toEqual(
      JSON.parse(vectors.sealedSpec.plaintext),
    );
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

  it("seals what it makes so the vectors' readers open it", async () => {
    const tokenKey = await keys.tokenKey(seed);
    const sealed = await copies.sealTokenKey(tokenKey, orgKey);
    const reopened = await copies.unsealTokenKey(sealed, orgKey);
    expect(Buffer.from(reopened.toEncoded()).toString("base64")).toBe(vectors.tokenKey);
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
    const spec: ScriptSpec = {
      v: 1,
      username: true,
      password: true,
      totp: false,
      fields: ["Break-glass PIN"],
    };
    expect(copyOf(tokenId, item, spec)).toEqual(JSON.parse(vectors.copy.plaintext));
  });

  it("leaves out what the item doesn't have", () => {
    const spec: ScriptSpec = {
      v: 1,
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
