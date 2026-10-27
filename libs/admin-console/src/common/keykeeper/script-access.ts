// Keykeeper: script access (docs/script-access.md in the meta repo). A
// token's seed is made here, in the admin's browser; from it come the auth
// secret the script sends and the token key that encrypts its copies, which
// the server never sees. The token key is also sealed with the organization
// key, so apps that hold that key can refresh copies after an item changes.
// Every app must compute these exactly as docs/vectors/script-access-v1.json,
// and seal and open the token key and specs as docs/vectors/script-grants-v2.json
// (version 2: each seal names the token, and a spec its item, so a server
// can't pair a token's key with an item it was never granted). The unit tests
// check both (copies sit next to them).

import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";

const encoder = new TextEncoder();
const copy = (bytes: Uint8Array) => new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const toB64Url = (bytes: Uint8Array) =>
  toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normal = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** What a grant copies from its item, as an admin chose it. */
export type ScriptFields = {
  username: boolean;
  password: boolean;
  /** The item's one-time code secret, so the script can make codes. */
  totp: boolean;
  /** Custom fields, by name. */
  fields: string[];
};

/**
 * A grant's spec as it's sealed, version 2: what it copies, and the token
 * and item it's for.
 */
export type ScriptSpec = ScriptFields & { v: 2; token: string; item: string };

/** A token key as it's sealed, version 2: the key, and the token it belongs to. */
type SealedTokenKey = { v: 2; token: string; key: string };

/** Ids as the server and the apps write them, compared without regard to case. */
const sameId = (a: unknown, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A grant's copy, as the token key encrypts it. */
export type ScriptCopy = {
  v: 1;
  token: string;
  item: string;
  revision: string;
  name: string;
  username?: string;
  password?: string;
  totp?: string;
  fields: Record<string, string>;
};

/** The parts of an item a copy can come from. */
export type CopiedItem = {
  id: string;
  name: string;
  revisionDate: Date | string;
  login?: { username?: string | null; password?: string | null; totp?: string | null } | null;
  fields?: { name?: string | null; value?: string | null }[] | null;
};

const TOKEN_STRING = /^pbs1_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

/** The item revision as the server writes it, which a copy must name. */
export function revisionText(revisionDate: Date | string): string {
  return typeof revisionDate === "string" ? revisionDate : revisionDate.toISOString();
}

/** The copy of an item a spec asks for, never anything it doesn't. */
export function copyOf(tokenId: string, item: CopiedItem, spec: ScriptFields): ScriptCopy {
  const fields: Record<string, string> = {};
  for (const name of spec.fields) {
    const field = (item.fields ?? []).find((f) => f.name === name);
    if (field?.value != null) {
      fields[name] = field.value;
    }
  }
  const result: ScriptCopy = {
    v: 1,
    token: tokenId,
    item: item.id,
    revision: revisionText(item.revisionDate),
    name: item.name,
    fields,
  };
  if (spec.username && item.login?.username) {
    result.username = item.login.username;
  }
  if (spec.password && item.login?.password) {
    result.password = item.login.password;
  }
  if (spec.totp && item.login?.totp) {
    result.totp = item.login.totp;
  }
  return result;
}

export class KeykeeperScriptKeys {
  constructor(private readonly subtle: SubtleCrypto = globalThis.crypto.subtle) {}

  /** A new token: its id and its seed, which never leave this browser except in the token string. */
  newToken(): { id: string; seed: Uint8Array } {
    return {
      id: globalThis.crypto.randomUUID(),
      seed: globalThis.crypto.getRandomValues(new Uint8Array(32)),
    };
  }

  /** The string an admin pastes into the RMM. */
  tokenString(tokenId: string, seed: Uint8Array): string {
    return `pbs1_${tokenId.replace(/-/g, "").toLowerCase()}_${toB64Url(seed)}`;
  }

  /** A token string's id and seed, or null for anything else. */
  parseTokenString(text: string): { id: string; seed: Uint8Array } | null {
    const match = TOKEN_STRING.exec(text.trim());
    const seed = match ? fromB64(match[2]) : null;
    if (match == null || seed?.length !== 32) {
      return null;
    }
    const hex = match[1];
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return { id, seed };
  }

  private async derive(seed: Uint8Array, info: string, bytes: number): Promise<Uint8Array> {
    const ikm = await this.subtle.importKey("raw", copy(seed), "HKDF", false, ["deriveBits"]);
    const bits = await this.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(info) },
      ikm,
      bytes * 8,
    );
    return new Uint8Array(bits);
  }

  /** What the script sends to prove it holds the token. */
  authSecret(seed: Uint8Array): Promise<Uint8Array> {
    return this.derive(seed, "passbundle script auth v1", 32);
  }

  /** The SHA-256 of the auth secret, base64: all the server keeps of it. */
  async authHash(seed: Uint8Array): Promise<string> {
    const secret = await this.authSecret(seed);
    return toB64(new Uint8Array(await this.subtle.digest("SHA-256", copy(secret))));
  }

  /** The key that encrypts the token's copies (upstream's 64-byte AES-CBC with HMAC key). */
  tokenKey(seed: Uint8Array): Promise<Uint8Array> {
    return this.derive(seed, "passbundle script key v1", 64);
  }

  /** The header a script sends. */
  async authorization(tokenId: string, seed: Uint8Array): Promise<string> {
    return `PassBundleScript ${tokenId}.${toB64Url(await this.authSecret(seed))}`;
  }
}

/** Encrypting and sealing for script access, with upstream's EncryptService. */
export class KeykeeperScriptCopies {
  constructor(private readonly encryptService: EncryptService) {}

  /** The token key, sealed with the organization key together with its token's id. */
  async sealTokenKey(
    tokenId: string,
    tokenKey: Uint8Array,
    orgKey: SymmetricCryptoKey,
  ): Promise<string> {
    const sealed: SealedTokenKey = { v: 2, token: tokenId, key: toB64(tokenKey) };
    return (await this.encryptService.encryptString(JSON.stringify(sealed), orgKey))
      .encryptedString!;
  }

  /**
   * Opens a sealed token key, only if it's version 2 and sealed for this
   * token: a server could otherwise hand an app another token's key, whose
   * seed someone else knows, to write this token's copies with.
   */
  async unsealTokenKey(
    sealed: string,
    orgKey: SymmetricCryptoKey,
    tokenId: string,
  ): Promise<SymmetricCryptoKey> {
    const opened = parseJson(
      await this.encryptService.decryptString(new EncString(sealed), orgKey),
    );
    const bytes = typeof opened?.key === "string" ? fromB64(opened.key) : null;
    if (opened?.v !== 2 || !sameId(opened.token, tokenId) || bytes?.length !== 64) {
      throw new Error("That isn't this script token's key");
    }
    return new SymmetricCryptoKey(bytes);
  }

  /** What a grant copies, sealed with the organization key together with its token's and item's ids. */
  async sealSpec(
    tokenId: string,
    itemId: string,
    fields: ScriptFields,
    orgKey: SymmetricCryptoKey,
  ): Promise<string> {
    const spec: ScriptSpec = {
      v: 2,
      token: tokenId,
      item: itemId,
      username: fields.username,
      password: fields.password,
      totp: fields.totp,
      fields: fields.fields,
    };
    return (await this.encryptService.encryptString(JSON.stringify(spec), orgKey)).encryptedString!;
  }

  /**
   * Opens a grant's spec, only if it's version 2 and sealed for this token
   * and this item: a server could otherwise pair a spec with an item it was
   * never granted.
   */
  async unsealSpec(
    sealed: string,
    orgKey: SymmetricCryptoKey,
    tokenId: string,
    itemId: string,
  ): Promise<ScriptSpec> {
    const spec = parseJson(await this.encryptService.decryptString(new EncString(sealed), orgKey));
    if (
      spec?.v !== 2 ||
      !sameId(spec.token, tokenId) ||
      !sameId(spec.item, itemId) ||
      !Array.isArray(spec.fields) ||
      !spec.fields.every((f) => typeof f === "string")
    ) {
      throw new Error("That isn't this grant's spec");
    }
    return {
      v: 2,
      token: tokenId,
      item: itemId,
      username: spec.username === true,
      password: spec.password === true,
      totp: spec.totp === true,
      fields: spec.fields as string[],
    };
  }

  async encryptCopy(scriptCopy: ScriptCopy, tokenKey: SymmetricCryptoKey): Promise<string> {
    return (await this.encryptService.encryptString(JSON.stringify(scriptCopy), tokenKey))
      .encryptedString!;
  }

  /** Opens a copy, checking it's for this token and this item. */
  async decryptCopy(
    encrypted: string,
    tokenKey: SymmetricCryptoKey,
    tokenId: string,
    itemId: string,
  ): Promise<ScriptCopy> {
    const scriptCopy: ScriptCopy = JSON.parse(
      await this.encryptService.decryptString(new EncString(encrypted), tokenKey),
    );
    if (scriptCopy.token !== tokenId || scriptCopy.item !== itemId) {
      throw new Error("That copy is for another token or item");
    }
    return scriptCopy;
  }
}
