// Keykeeper: script access from the command-line tool (docs/script-access.md
// in the meta repo), as the PowerShell module the server serves does it
// (PassBundle.psm1): a script token alone, with no account, session, or data
// folder. From the token's seed come the auth secret the script sends and the
// token key that opens its copies, which the server never sees; the copy is
// decrypted here and only the asked-for value leaves. The crypto is the
// module's, in Node's own: HKDF-SHA256 with no salt, then upstream's type 2
// encrypted string (AES-256-CBC, HMAC-SHA256 over the IV and ciphertext,
// checked in constant time before anything is decrypted). The unit tests check
// it against docs/vectors/script-access-v1.json (a copy is next to them).

import { createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { CLI_BRAND, CliBrand } from "./brand";

/** Something the script can't get, in words a person running it can act on. */
export class ScriptAccessError extends Error {}

/** A token string's id, and the auth secret and token key from its seed. */
export type ScriptToken = { id: string; secret: Buffer; key: Buffer };

/** A grant's copy, as the token key encrypts it (docs/script-access.md, "A copy"). */
export type ScriptCopy = {
  token: string;
  item: string;
  revision?: string;
  name: string;
  username?: string;
  password?: string;
  totp?: string;
  fields: Record<string, string>;
};

/** What the server answers for one grant. */
type ScriptEntry = { itemId: string; copy: string };

/** The server's answer to one request: its status, and its body as JSON. */
export type ScriptAnswer = { status: number; json: () => Promise<unknown> };

/** Sends a GET with these headers. */
export type ScriptFetch = (url: string, headers: Record<string, string>) => Promise<ScriptAnswer>;

const TOKEN = /^pbs1_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The variable a script keeps its token in, such as PASSBUNDLE_SCRIPT_TOKEN. */
export function scriptTokenVariable(brand: CliBrand = CLI_BRAND): string {
  return `${brand.envPrefix}SCRIPT_TOKEN`;
}

/** The variable that names the server, such as PASSBUNDLE_SERVER. */
export function scriptServerVariable(brand: CliBrand = CLI_BRAND): string {
  return `${brand.envPrefix}SERVER`;
}

const hkdf = (seed: Buffer, info: string, length: number) =>
  Buffer.from(hkdfSync("sha256", seed, Buffer.alloc(0), info, length));

/** A token string's id and keys, or why it isn't one. */
export function readScriptToken(text: string, brand: CliBrand = CLI_BRAND): ScriptToken {
  const match = TOKEN.exec(text.trim());
  const seed = match ? Buffer.from(match[2], "base64url") : null;
  if (match == null || seed?.length !== 32) {
    throw new ScriptAccessError(`That isn't a ${brand.name} script token (it starts with pbs1_).`);
  }
  const hex = match[1];
  return {
    id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    secret: hkdf(seed, "passbundle script auth v1", 32),
    key: hkdf(seed, "passbundle script key v1", 64),
  };
}

/** The header a script sends: the token's id and auth secret, nothing else. */
export function scriptAuthorization(token: ScriptToken): string {
  return `PassBundleScript ${token.id}.${token.secret.toString("base64url")}`;
}

/** Strict base64, as the server and upstream's apps write it. */
function fromBase64(text: string): Buffer | null {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0
    ? Buffer.from(text, "base64")
    : null;
}

/**
 * Opens an encrypted string (type 2) with the token key, refusing it unless
 * its MAC is the token key's. Throws for anything else.
 */
export function openEncrypted(encrypted: string, key: Buffer): string {
  const parts = /^2\.([^|]+)\|([^|]+)\|([^|]+)$/.exec(encrypted);
  const [iv, data, mac] = parts ? parts.slice(1).map(fromBase64) : [];
  if (iv == null || data == null || mac == null || iv.length !== 16) {
    throw new ScriptAccessError("The server sent something that isn't a copy.");
  }
  const expected = createHmac("sha256", key.subarray(32, 64))
    .update(Buffer.concat([iv, data]))
    .digest();
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    throw new ScriptAccessError(
      "A copy failed its integrity check. It wasn't made with this token's key.",
    );
  }
  try {
    const decipher = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new ScriptAccessError("The server sent something that isn't a copy.");
  }
}

const sameId = (a: unknown, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Opens a copy, checking it was made for this token and this item: a server
 * can't hand the script another item's copy, or another token's.
 */
export function openCopy(encrypted: string, token: ScriptToken, itemId: string): ScriptCopy {
  let copy: unknown;
  try {
    copy = JSON.parse(openEncrypted(encrypted, token.key));
  } catch (e) {
    throw e instanceof ScriptAccessError
      ? e
      : new ScriptAccessError("The server sent something that isn't a copy.");
  }
  if (copy == null || typeof copy !== "object" || Array.isArray(copy)) {
    throw new ScriptAccessError("The server sent something that isn't a copy.");
  }
  const c = copy as Record<string, unknown>;
  if (!sameId(c.token, token.id) || !sameId(c.item, itemId)) {
    throw new ScriptAccessError("The server sent a copy made for another token or item.");
  }
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  // Field names are whatever an item's editor wrote, "__proto__" included.
  const fields: Record<string, string> = Object.create(null);
  if (c.fields != null && typeof c.fields === "object" && !Array.isArray(c.fields)) {
    for (const [name, value] of Object.entries(c.fields)) {
      if (typeof value === "string") {
        fields[name] = value;
      }
    }
  }
  const result: ScriptCopy = {
    token: c.token as string,
    item: c.item as string,
    name: text(c.name) ?? "",
    fields,
  };
  for (const name of ["revision", "username", "password", "totp"] as const) {
    const value = text(c[name]);
    if (value != null) {
      result[name] = value;
    }
  }
  return result;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * A one-time code (RFC 6238) from a copied secret: a base32 secret (6 digits,
 * SHA-1, 30 seconds), or an otpauth:// address with its own. Made on this
 * computer at `at` (milliseconds).
 */
export function oneTimeCode(secret: string, at: number = Date.now()): string {
  let key = secret;
  let digits = 6;
  let period = 30;
  let algorithm = "SHA1";
  if (/^otpauth:\/\//i.test(secret)) {
    const query = secret.split("?", 2)[1] ?? "";
    for (const pair of query.split("&")) {
      const equals = pair.indexOf("=");
      const name = (equals < 0 ? pair : pair.slice(0, equals)).toLowerCase();
      let value = equals < 0 ? "" : pair.slice(equals + 1);
      try {
        value = decodeURIComponent(value);
      } catch {
        // Kept as written.
      }
      if (name === "secret") {
        key = value;
      } else if (name === "digits") {
        digits = Number(value);
      } else if (name === "period") {
        period = Number(value);
      } else if (name === "algorithm") {
        algorithm = value.toUpperCase();
      }
    }
  } else if (/^steam:\/\//i.test(secret)) {
    throw new ScriptAccessError("Steam one-time codes aren't supported in scripts.");
  }
  if (
    !Number.isInteger(digits) ||
    digits < 1 ||
    digits > 10 ||
    !Number.isInteger(period) ||
    period < 1
  ) {
    throw new ScriptAccessError("The one-time code's settings aren't ones scripts can use.");
  }
  let bits = "";
  for (const c of key.toUpperCase().replace(/ /g, "").replace(/=+$/, "")) {
    const index = BASE32.indexOf(c);
    if (index < 0) {
      throw new ScriptAccessError("The one-time code secret isn't base32.");
    }
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  const hash = algorithm === "SHA256" ? "sha256" : algorithm === "SHA512" ? "sha512" : "sha1";
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Math.floor(at / 1000) / period)));
  const mac = createHmac(hash, bytes).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = mac.readUInt32BE(offset) & 0x7fffffff;
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

/** The fields a copy can have besides custom ones; any other name is a custom field. */
export const LOGIN_FIELDS = ["username", "password", "totp"] as const;

/**
 * One value from a copy: its username, password, a current one-time code
 * (`totp`), or a custom field by name. As the module does, `username`,
 * `password`, and `totp` are the login's whatever their case, and a custom
 * field matches its name exactly, or else its one name that differs only in
 * case.
 */
export function grantedValue(copy: ScriptCopy, field: string, at: number = Date.now()): string {
  const login = LOGIN_FIELDS.find((f) => f === field.toLowerCase());
  if (login != null) {
    const value = copy[login];
    if (value != null) {
      return login === "totp" ? oneTimeCode(value, at) : value;
    }
  } else if (Object.prototype.hasOwnProperty.call(copy.fields, field)) {
    return copy.fields[field];
  } else {
    const alike = Object.keys(copy.fields).filter((f) => f.toLowerCase() === field.toLowerCase());
    if (alike.length === 1) {
      return copy.fields[alike[0]];
    }
  }
  throw new ScriptAccessError(`This token wasn't granted '${field}' of ${copy.name}.`);
}

/** Where the script asks: an https address, without a trailing slash. */
export function scriptServer(given: string | undefined, brand: CliBrand = CLI_BRAND): string {
  const server = (given ?? "").trim() || brand.server;
  if (!server) {
    throw new ScriptAccessError(`Say which server: --server or ${scriptServerVariable(brand)}.`);
  }
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new ScriptAccessError(`${server} isn't a server's address.`);
  }
  if (url.protocol !== "https:") {
    throw new ScriptAccessError(
      `${server} isn't an https address. A token goes only to a server over https.`,
    );
  }
  return url.toString().replace(/\/+$/, "");
}

/** Asks the server for a path under its script endpoints, saying what a refusal means. */
async function ask(
  server: string,
  path: string,
  token: ScriptToken,
  fetch: ScriptFetch,
  brand: CliBrand,
): Promise<unknown> {
  let answer: ScriptAnswer;
  try {
    answer = await fetch(`${server}/api/keykeeper/script/${path}`, {
      Authorization: scriptAuthorization(token),
      Accept: "application/json",
    });
  } catch (e) {
    throw new ScriptAccessError(
      `Couldn't reach ${brand.name} at ${server}: ${(e as Error).message}`,
    );
  }
  switch (answer.status) {
    case 200:
      break;
    case 401:
      throw new ScriptAccessError(
        "The server refused the token: it was revoked or expired, whoever made it no longer " +
          "manages the organization, it was mistyped, or it was used from a network it isn't " +
          "allowed on.",
      );
    case 404:
      throw new ScriptAccessError("This token can't read that item.");
    case 429:
      throw new ScriptAccessError("Too many reads with this token; try again in a minute.");
    default:
      throw new ScriptAccessError(
        `Couldn't reach ${brand.name} at ${server}: it answered ${answer.status}.`,
      );
  }
  try {
    return await answer.json();
  } catch {
    throw new ScriptAccessError(`${server} answered with something that isn't ${brand.name}'s.`);
  }
}

const entryOf = (value: unknown): ScriptEntry | null => {
  const v = value as Partial<ScriptEntry> | null;
  return typeof v?.itemId === "string" && typeof v.copy === "string"
    ? { itemId: v.itemId, copy: v.copy }
    : null;
};

/**
 * The copy of the item a script asks for: by its id, or by its name among
 * the token's copies (which must name just one).
 */
export async function findCopy(
  item: string,
  token: ScriptToken,
  server: string,
  fetch: ScriptFetch,
  brand: CliBrand = CLI_BRAND,
): Promise<ScriptCopy> {
  if (ID.test(item)) {
    const id = item.toLowerCase();
    const entry = entryOf(await ask(server, `items/${id}`, token, fetch, brand));
    if (entry == null || !sameId(entry.itemId, id)) {
      throw new ScriptAccessError("The server sent a copy made for another token or item.");
    }
    return openCopy(entry.copy, token, id);
  }
  const answer = (await ask(server, "items", token, fetch, brand)) as { data?: unknown } | null;
  if (!Array.isArray(answer?.data)) {
    throw new ScriptAccessError(`${server} answered with something that isn't ${brand.name}'s.`);
  }
  const found = answer.data
    .map((value) => {
      const entry = entryOf(value);
      if (entry == null) {
        throw new ScriptAccessError("The server sent something that isn't a copy.");
      }
      return openCopy(entry.copy, token, entry.itemId);
    })
    .filter((copy) => copy.name.toLowerCase() === item.toLowerCase());
  if (found.length === 0) {
    throw new ScriptAccessError(`This token can't read an item named '${item}'.`);
  }
  if (found.length > 1) {
    throw new ScriptAccessError(
      `This token can read more than one item named '${item}'. Ask for it by its id.`,
    );
  }
  return found[0];
}

/** One granted value of an item, as `script get` prints it. */
export async function scriptGet(request: {
  item: string;
  field: string;
  token: string;
  server: string;
  fetch: ScriptFetch;
  brand?: CliBrand;
  now?: () => number;
}): Promise<string> {
  const brand = request.brand ?? CLI_BRAND;
  const token = readScriptToken(request.token, brand);
  const copy = await findCopy(request.item, token, request.server, request.fetch, brand);
  return grantedValue(copy, request.field, (request.now ?? Date.now)());
}
