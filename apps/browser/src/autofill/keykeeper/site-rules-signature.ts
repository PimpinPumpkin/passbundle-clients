// Keykeeper: the Ed25519 check for site rules feeds (DESIGN.md, "Fill rules
// for everyone", "Shipping: a signed feed"), as strict as the desktop
// updater's (passbundle-apps core/src/updates/manifest.rs, ed25519-dalek's
// verify_strict): pure Ed25519 (RFC 8032) over a prefix and the manifest's
// exact bytes, refusing a malleable signature (S not reduced), a small-order
// R, and a small-order key. It also refuses a key or R that isn't a canonical
// encoding (y >= p), as RFC 8032's decoding does; verify_strict takes such a
// key when it isn't small order, so this is stricter there.
//
// The curve arithmetic is node-forge's Ed25519 (TweetNaCl's), which the
// extension already ships (libs/legacy-crypto). On its own it takes a
// small-order key or R; the checks around it here are what make it strict.
// WebCrypto's Ed25519 isn't in every browser the extension supports (Chrome
// 134 and Firefox 91 are the manifests' minimums; Chrome has it from 137,
// Firefox from 129), and browsers differ on these checks.

import * as forge from "node-forge";

/** What's signed: this, then the manifest's exact bytes. */
export const SITE_RULES_PREFIX = "PassBundle site rules v1\n";

/** The most a signature file may be. */
export const MAX_SIGNATURE_FILE = 1024;

const BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const HEX_KEY = /^[0-9a-f]{64}$/;

/**
 * The y coordinates (little-endian, sign bit cleared) of the eight
 * small-order points: 0 (order 4, both signs), 1 (the neutral point), p - 1
 * (order 2), and the two of order 8 (each with both signs).
 */
const SMALL_ORDER_Y = [
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
].map(fromHex);

/** The group's order, L, little-endian. */
const L = fromHex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010");

function fromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Whether a point's 32 bytes encode y below p (2^255 - 19), ignoring the sign bit. */
function isCanonicalPoint(point: Uint8Array): boolean {
  if ((point[31] & 0x7f) !== 0x7f) {
    return true;
  }
  for (let i = 30; i > 0; i--) {
    if (point[i] !== 0xff) {
      return true;
    }
  }
  return point[0] < 0xed;
}

/** Whether a point's 32 bytes are one of the small-order points, with either sign. */
function isSmallOrder(point: Uint8Array): boolean {
  return SMALL_ORDER_Y.some((y) => {
    for (let i = 0; i < 31; i++) {
      if (point[i] !== y[i]) {
        return false;
      }
    }
    return (point[31] & 0x7f) === y[31];
  });
}

/** Whether S (little-endian) is below L. */
function isReduced(s: Uint8Array): boolean {
  for (let i = 31; i >= 0; i--) {
    if (s[i] !== L[i]) {
      return s[i] < L[i];
    }
  }
  return false;
}

/** A key as the feed's settings give it (64 lowercase hex digits), if it's one a signature may check with. */
export function strictKey(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || !HEX_KEY.test(hex)) {
    return null;
  }
  const key = fromHex(hex);
  return isCanonicalPoint(key) && !isSmallOrder(key) ? key : null;
}

/**
 * A signature file's 64 bytes: strict base64 (the standard alphabet, padded,
 * and nothing set past the 64 bytes), with surrounding ASCII whitespace
 * allowed, as the desktop updater reads its signature file.
 */
export function signatureBytes(file: string): Uint8Array | null {
  if (typeof file !== "string" || file.length > MAX_SIGNATURE_FILE) {
    return null;
  }
  const text = file.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
  if (!BASE64.test(text)) {
    return null;
  }
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  // Re-encoding must give the same text: no bits set past the end.
  return bytes.length === 64 && btoa(binary) === text ? bytes : null;
}

/** Strict Ed25519 over exactly `message` with one 32-byte key. */
export function verifyStrict(message: Uint8Array, signature: Uint8Array, key: Uint8Array): boolean {
  if (signature.length !== 64 || key.length !== 32) {
    return false;
  }
  const r = signature.subarray(0, 32);
  if (!isCanonicalPoint(key) || isSmallOrder(key)) {
    return false;
  }
  if (!isCanonicalPoint(r) || isSmallOrder(r) || !isReduced(signature.subarray(32))) {
    return false;
  }
  try {
    return forge.pki.ed25519.verify({
      message: new Uint8Array(message),
      signature: new Uint8Array(signature),
      publicKey: new Uint8Array(key),
    });
  } catch {
    return false;
  }
}

/**
 * Whether `signatureFile` is a signature by one of `keys` (hex) over the
 * prefix and the manifest's exact bytes.
 */
export function feedSignatureChecks(
  manifest: Uint8Array,
  signatureFile: string,
  keys: readonly string[],
): boolean {
  const signature = signatureBytes(signatureFile);
  if (signature == null) {
    return false;
  }
  const prefix = new TextEncoder().encode(SITE_RULES_PREFIX);
  const signed = new Uint8Array(prefix.length + manifest.length);
  signed.set(prefix, 0);
  signed.set(manifest, prefix.length);
  return keys.some((hex) => {
    const key = strictKey(hex);
    return key != null && verifyStrict(signed, signature, key);
  });
}
