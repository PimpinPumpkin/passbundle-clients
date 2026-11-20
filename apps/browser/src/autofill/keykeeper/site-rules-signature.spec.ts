/**
 * @jest-environment node
 */
// Node's environment, not jsdom's: node-forge's Ed25519 tells bytes apart by
// `instanceof ArrayBuffer`, which jsdom's second set of globals breaks. The
// extension has one set, as here.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

import * as forge from "node-forge";

import {
  feedSignatureChecks,
  signatureBytes,
  SITE_RULES_PREFIX,
  strictKey,
  verifyStrict,
} from "./site-rules-signature";
import vectors from "./site-rules-v1.vectors.json";

const fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** An Ed25519 key from a 32-byte seed, with Node's crypto (OpenSSL), independent of node-forge. */
function keyFrom(seed: Uint8Array) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = new Uint8Array(
    createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32),
  );
  return {
    publicKey,
    sign: (message: Uint8Array) => new Uint8Array(sign(null, Buffer.from(message), privateKey)),
  };
}

// Edwards25519 in plain BigInt, to check the small-order list is what it says.
// (BigInt(...) rather than literals: the spec build targets ES2017.)
const N = (n: number) => BigInt(n);
const P = (N(1) << N(255)) - N(19);
const D = (((-N(121665) * modPow(N(121666), P - N(2))) % P) + P) % P;
const SQRT_M1 = modPow(N(2), (P - N(1)) / N(4));
function mod(a: bigint) {
  return ((a % P) + P) % P;
}
function modPow(b: bigint, e: bigint): bigint {
  let r = N(1);
  b = ((b % P) + P) % P;
  while (e > N(0)) {
    if (e & N(1)) {
      r = (r * b) % P;
    }
    b = (b * b) % P;
    e >>= N(1);
  }
  return r;
}
type Point = [bigint, bigint];
function decode(bytes: Uint8Array): Point | null {
  const sign = bytes[31] >> 7;
  const copy = Uint8Array.from(bytes);
  copy[31] &= 0x7f;
  const y = BigInt(`0x${hex(copy.reverse())}`);
  if (y >= P) {
    return null;
  }
  const u = mod(y * y - N(1));
  const v = mod(D * y * y + N(1));
  const x2 = mod(u * modPow(v, P - N(2)));
  let x = modPow(x2, (P + N(3)) / N(8));
  if (mod(x * x - x2) !== N(0)) {
    x = mod(x * SQRT_M1);
  }
  if (mod(x * x - x2) !== N(0)) {
    return null;
  }
  if (Number(x & N(1)) !== sign) {
    x = mod(-x);
  }
  return [x, y];
}
function add([x1, y1]: Point, [x2, y2]: Point): Point {
  const t = mod(D * x1 * x2 * y1 * y2);
  return [
    mod((x1 * y2 + x2 * y1) * modPow(N(1) + t, P - N(2))),
    mod((y1 * y2 + x1 * x2) * modPow(N(1) - t, P - N(2))),
  ];
}
function timesEight(p: Point): Point {
  let q = p;
  for (let i = 0; i < 3; i++) {
    q = add(q, q);
  }
  return q;
}
const BASE_Y = mod(N(4) * modPow(N(5), P - N(2)));
function times(k: bigint, p: Point): Point {
  let result: Point = [N(0), N(1)];
  let addend = p;
  while (k > N(0)) {
    if (k & N(1)) {
      result = add(result, addend);
    }
    addend = add(addend, addend);
    k >>= N(1);
  }
  return result;
}
function encode([x, y]: Point): Uint8Array {
  const bytes = fromHex(y.toString(16).padStart(64, "0")).reverse();
  bytes[31] |= Number(x & N(1)) << 7;
  return bytes;
}
const L = (N(1) << N(252)) + BigInt("27742317777372353535851937790883648493");
const fromLE = (bytes: Uint8Array) => BigInt(`0x${hex(Uint8Array.from(bytes).reverse())}`);

describe("site rules signatures", () => {
  // RFC 8032, section 7.1, TEST 1 and TEST 2.
  it("takes RFC 8032's test signatures", () => {
    expect(
      verifyStrict(
        new Uint8Array(),
        fromHex(
          "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        ),
        fromHex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"),
      ),
    ).toBe(true);
    expect(
      verifyStrict(
        fromHex("72"),
        fromHex(
          "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
        ),
        fromHex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"),
      ),
    ).toBe(true);
  });

  it("takes signatures Node's crypto makes, and refuses each with a changed byte", () => {
    for (let i = 0; i < 16; i++) {
      const key = keyFrom(Uint8Array.from({ length: 32 }, (_, j) => (i * 31 + j * 7) & 0xff));
      const message = new TextEncoder().encode(`message ${i}`);
      const signature = key.sign(message);
      expect(verifyStrict(message, signature, key.publicKey)).toBe(true);
      const changed = Uint8Array.from(signature);
      changed[i * 4] ^= 0x10;
      expect(verifyStrict(message, changed, key.publicKey)).toBe(false);
      const other = Uint8Array.from(message);
      other[0] ^= 1;
      expect(verifyStrict(other, signature, key.publicKey)).toBe(false);
    }
  });

  it("lists exactly the small-order points: eight times each is the neutral point", () => {
    const smallOrder = [
      "0000000000000000000000000000000000000000000000000000000000000000",
      "0100000000000000000000000000000000000000000000000000000000000000",
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    ];
    for (const y of smallOrder) {
      for (const signBit of [0, 0x80]) {
        const encoded = fromHex(y);
        encoded[31] |= signBit;
        const point = decode(encoded);
        if (point == null) {
          continue;
        }
        expect(timesEight(point)).toEqual([N(0), N(1)]);
        expect(strictKey(hex(encoded))).toBeNull();
      }
    }
    // A real key isn't small order, and passes.
    const real = decode(fromHex(vectors.key.public))!;
    expect(timesEight(real)).not.toEqual([N(0), N(1)]);
    expect(strictKey(vectors.key.public)).not.toBeNull();
  });

  it("refuses what node-forge alone takes: a small-order key, and a small-order R", () => {
    const manifest = vectors.cases.find((c) => c.name === "as signed")!.manifest;
    const signed = new TextEncoder().encode(SITE_RULES_PREFIX + manifest);
    const neutralKey = vectors.cases.find((c) => c.name.startsWith("a small-order key"))!;
    const smallR = vectors.cases.find((c) => c.name.startsWith("R is a small-order point"))!;
    const lax = (signature: Uint8Array, key: Uint8Array) =>
      forge.pki.ed25519.verify({ message: signed, signature, publicKey: key });

    const neutralSignature = signatureBytes(neutralKey.signature)!;
    const neutral = fromHex(neutralKey.keys![0]);
    expect(lax(neutralSignature, neutral)).toBe(true);
    expect(verifyStrict(signed, neutralSignature, neutral)).toBe(false);

    const smallRSignature = signatureBytes(smallR.signature)!;
    const key = fromHex(vectors.key.public);
    expect(lax(smallRSignature, key)).toBe(true);
    expect(verifyStrict(signed, smallRSignature, key)).toBe(false);
  });

  it("refuses a small-order key even with a large-order R, which node-forge alone takes", () => {
    // The order-2 point (0, -1) as the key: with an even k, [k]A is the
    // neutral point, so R = [S]B passes a check that doesn't refuse the key.
    const key = fromHex("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f");
    // The base point: y = 4/5, and the even x.
    const basePoint = decode(encode([N(0), BASE_Y]))!;
    let found = false;
    for (let s = 1; s < 64 && !found; s++) {
      const message = new TextEncoder().encode(`small-order key ${s}`);
      const r = encode(times(BigInt(s), basePoint));
      const k = createHash("sha512")
        .update(Buffer.concat([r, key, message]))
        .digest();
      if ((fromLE(k) % L) % N(2) !== N(0)) {
        continue;
      }
      found = true;
      const signature = new Uint8Array(64);
      signature.set(r, 0);
      signature.set(fromHex(BigInt(s).toString(16).padStart(64, "0")).reverse(), 32);
      expect(forge.pki.ed25519.verify({ message, signature, publicKey: key })).toBe(true);
      expect(verifyStrict(message, signature, key)).toBe(false);
    }
    expect(found).toBe(true);
  });

  it("reads a signature file as strict base64 of 64 bytes, with surrounding whitespace", () => {
    const good = vectors.cases.find((c) => c.name === "as signed")!.signature;
    expect(signatureBytes(good)).toHaveLength(64);
    expect(signatureBytes(`  ${good.trim()}\r\n\t`)).toHaveLength(64);
    expect(signatureBytes(good.trim().replace(/==$/, ""))).toBeNull();
    expect(signatureBytes(good.trim().replace(/==$/, "=") + "=\n=")).toBeNull();
    expect(signatureBytes(good.trim().replace(/\+/g, "-"))).toBeNull();
    expect(signatureBytes(good.trim() + good.trim())).toBeNull();
    expect(signatureBytes(" ".repeat(2000) + good)).toBeNull();
  });

  it("takes keys only as 64 lowercase hex digits", () => {
    expect(strictKey(vectors.key.public)).toHaveLength(32);
    expect(strictKey(vectors.key.public.toUpperCase())).toBeNull();
    expect(strictKey(vectors.key.public.slice(2))).toBeNull();
    expect(strictKey(`${vectors.key.public} `)).toBeNull();
    expect(strictKey(Buffer.from(vectors.key.public, "hex").toString("base64"))).toBeNull();
  });

  it("checks a feed's signature over the prefix and the manifest with any listed key", () => {
    const key = keyFrom(Uint8Array.from({ length: 32 }, (_, i) => i));
    const manifest = new TextEncoder().encode('{"maps":{}}');
    const file = `${Buffer.from(key.sign(new TextEncoder().encode(SITE_RULES_PREFIX + '{"maps":{}}'))).toString("base64")}\n`;
    expect(feedSignatureChecks(manifest, file, [vectors.key.public, hex(key.publicKey)])).toBe(
      true,
    );
    expect(feedSignatureChecks(manifest, file, [vectors.key.public])).toBe(false);
    expect(feedSignatureChecks(manifest, file, [])).toBe(false);
    expect(feedSignatureChecks(manifest, file, ["not a key", hex(key.publicKey)])).toBe(true);
  });
});
