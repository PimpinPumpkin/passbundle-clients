// Checks the script access test vectors (docs/script-access.md in the meta
// repo) with upstream's own crypto (the SDK's PureCrypto, which the web vault
// uses to encrypt and decrypt): the sealed token key and spec open with the
// organization key, every copy opens with the token key, tampered ones are
// refused, and what upstream encrypts with the token key opens in plain Node,
// as the PowerShell module opens it.
//
//   node scripts/keykeeper/check-script-vectors.mjs libs/admin-console/src/common/keykeeper/script-access.vectors.json .
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const [vectorsPath, clientsRoot] = process.argv.slice(2);
// createRequire wants an absolute path.
const require = createRequire(path.resolve(clientsRoot, "package.json"));
const { PureCrypto } = require("@bitwarden/sdk-internal");
const v = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
const key = (b64) => Buffer.from(b64, "base64");

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) {
    failures++;
  }
};
const opens = (encString, withKey) => {
  try {
    return PureCrypto.symmetric_decrypt_string(encString, withKey);
  } catch {
    return null;
  }
};

const orgKey = key(v.inputs.organizationKey);
const tokenKey = key(v.tokenKey);
check(
  opens(v.sealedTokenKey.encString, orgKey) === v.sealedTokenKey.plaintext,
  "the sealed token key opens with the organization key",
);
check(
  opens(v.sealedSpec.encString, orgKey) === v.sealedSpec.plaintext,
  "the sealed spec opens with the organization key",
);
check(opens(v.copy.encString, tokenKey) === v.copy.plaintext, "the copy opens with the token key");
for (const m of v.mismatched) {
  // Sound under the token key; the apps and the module refuse them for their ids.
  const opened = JSON.parse(opens(m.encString, tokenKey) ?? "null");
  check(
    opened != null && (opened.token !== v.inputs.tokenId || opened.item !== v.inputs.itemId),
    `opens, but names another token or item: ${m.why}`,
  );
}
for (const r of v.refused) {
  check(opens(r.encString, tokenKey) === null, `refused: ${r.why}`);
}

const upstream = PureCrypto.symmetric_encrypt_string("from upstream", tokenKey);
const [type, rest] = upstream.split(".");
const [iv, ct, mac] = rest.split("|").map((p) => Buffer.from(p, "base64"));
const expectedMac = crypto
  .createHmac("sha256", tokenKey.subarray(32))
  .update(Buffer.concat([iv, ct]))
  .digest();
const decipher = crypto.createDecipheriv("aes-256-cbc", tokenKey.subarray(0, 32), iv);
const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString();
check(
  type === "2" && mac.equals(expectedMac) && plain === "from upstream",
  "upstream's encryption with the token key opens in plain Node",
);

process.exit(failures ? 1 : 0);
