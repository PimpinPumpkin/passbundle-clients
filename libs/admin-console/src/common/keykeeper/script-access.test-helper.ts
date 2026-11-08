// Test helper for script access: upstream's type 2 encrypted strings in plain
// Node, standing in for the EncryptService (which needs the SDK). The meta
// repo checks the same vectors with upstream's own crypto
// (check-script-vectors.mjs, run in tier 1).

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

export const nodeEncrypt = {
  async encryptString(plaintext: string, key: SymmetricCryptoKey) {
    const raw = Buffer.from(key.toEncoded());
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", raw.subarray(0, 32), iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const mac = createHmac("sha256", raw.subarray(32))
      .update(Buffer.concat([iv, ct]))
      .digest();
    return new EncString(
      `2.${iv.toString("base64")}|${ct.toString("base64")}|${mac.toString("base64")}`,
    );
  },
  async decryptString(enc: EncString, key: SymmetricCryptoKey) {
    const raw = Buffer.from(key.toEncoded());
    const [iv, ct, mac] = enc
      .encryptedString!.slice(2)
      .split("|")
      .map((p) => Buffer.from(p, "base64"));
    const expected = createHmac("sha256", raw.subarray(32))
      .update(Buffer.concat([iv, ct]))
      .digest();
    if (expected.length !== mac.length || !timingSafeEqual(expected, mac)) {
      throw new Error("MAC mismatch");
    }
    const decipher = createDecipheriv("aes-256-cbc", raw.subarray(0, 32), iv);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  },
} as unknown as EncryptService;
