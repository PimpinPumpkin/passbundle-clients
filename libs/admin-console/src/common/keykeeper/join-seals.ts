// Keykeeper: the computations behind "Joins a hacked server can't forge"
// (DESIGN.md). Each one is an HMAC-SHA256 over its parts joined with a zero
// byte, under a key the server never has: the organization's join key (made
// from the organization key) for seals, and the install command's join secret
// for join proofs. The join key, joining seals, and join proofs are version 1
// (the meta repo's docs/vectors/joins-v1.json); invitation and staff seals are
// version 2, which end and carry a nonce, and the client seal is new in the
// same change (docs/vectors/joins-v2.json). The unit tests check every one
// against a copy of the vectors that sits next to them.

const encoder = new TextEncoder();

/** Parts joined with a zero byte between them, strings as UTF-8. */
function joinParts(parts: (string | Uint8Array)[]): Uint8Array<ArrayBuffer> {
  const encoded = parts.map((p) => (typeof p === "string" ? encoder.encode(p) : p));
  const out = new Uint8Array(encoded.reduce((n, p) => n + p.length, encoded.length - 1));
  let at = 0;
  encoded.forEach((part, i) => {
    if (i > 0) {
      out[at++] = 0;
    }
    out.set(part, at);
    at += part.length;
  });
  return out;
}

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

const copy = (bytes: Uint8Array) => new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;

/** A join secret's form in the install command: 32 bytes, base64url. */
export const JOIN_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** How long an invitation's or a staff member's seal vouches for them. */
export const SEAL_LIFETIME_SECONDS = 14 * 86_400;
/**
 * The furthest ahead an app accepts a seal's end: a little more than a
 * seal's lifetime, for a sealing device whose clock runs ahead.
 */
export const SEAL_MAX_AHEAD_SECONDS = 30 * 86_400;

/** An invitation's or staff member's seal, version 2: `v2.<expires>.<nonce>.<mac>`. */
const EXPIRING_SEAL = /^v2\.([0-9]{1,12})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

/** What an expiring seal says besides its MAC: when it ends (Unix seconds) and its nonce. */
export type ExpiringSeal = { expires: number; nonce: string };

/** The end and nonce of an expiring seal, or null for anything else. */
export function parseExpiringSeal(seal: string | null | undefined): ExpiringSeal | null {
  const match = seal == null ? null : EXPIRING_SEAL.exec(seal);
  return match == null ? null : { expires: Number(match[1]), nonce: match[2] };
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export class KeykeeperJoinSeals {
  constructor(private readonly subtle: SubtleCrypto = globalThis.crypto.subtle) {}

  /** The organization's join key, from its 64-byte organization key. */
  async joinKey(organizationKey: Uint8Array): Promise<Uint8Array> {
    const ikm = await this.subtle.importKey("raw", copy(organizationKey), "HKDF", false, [
      "deriveBits",
    ]);
    const bits = await this.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: encoder.encode("passbundle join key v1"),
      },
      ikm,
      256,
    );
    return new Uint8Array(bits);
  }

  /** A new join secret for an install command. */
  newJoinSecret(): string {
    return toB64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  }

  /** The install command's fingerprint of the organization's public key (SPKI). */
  async fingerprint(organizationPublicKey: Uint8Array): Promise<string> {
    return toB64Url(new Uint8Array(await this.sha256(organizationPublicKey)));
  }

  /** That a join knew the install command's secret, bound to the person's public key. */
  async joinProof(
    secret: string,
    organizationId: string,
    userId: string,
    userPublicKey: Uint8Array,
  ): Promise<string> {
    return this.sign(
      this.secretBytes(secret),
      await this.proofParts(organizationId, userId, userPublicKey),
    );
  }

  async checkJoinProof(
    proof: string | null | undefined,
    secret: string,
    organizationId: string,
    userId: string,
    userPublicKey: Uint8Array,
  ): Promise<boolean> {
    return this.verify(
      this.secretBytes(secret),
      await this.proofParts(organizationId, userId, userPublicKey),
      proof,
    );
  }

  /**
   * That an owner or admin invited this email: it vouches until
   * SEAL_LIFETIME_SECONDS from `now`, once per device (its nonce).
   */
  inviteSeal(
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
    now: Date = new Date(),
  ): Promise<string> {
    return this.newExpiringSeal("invite", joinKey, organizationId, email, now);
  }

  checkInviteSeal(
    seal: string | null | undefined,
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.checkExpiringSeal("invite", seal, joinKey, organizationId, email, now);
  }

  /** That an MSP admin made this email staff with a place in this client, for a while. */
  staffSeal(
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
    now: Date = new Date(),
  ): Promise<string> {
    return this.newExpiringSeal("staff", joinKey, organizationId, email, now);
  }

  checkStaffSeal(
    seal: string | null | undefined,
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.checkExpiringSeal("staff", seal, joinKey, organizationId, email, now);
  }

  /** An expiring seal with this end and nonce: for the vectors, and under `inviteSeal` and `staffSeal`. */
  async expiringSeal(
    kind: "invite" | "staff",
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
    expires: number,
    nonce: string,
  ): Promise<string> {
    const mac = await this.mac(
      joinKey,
      this.expiringParts(kind, organizationId, email, expires, nonce),
    );
    return `v2.${expires}.${nonce}.${toB64Url(mac)}`;
  }

  /**
   * That an MSP admin's browser, holding the organization's key, made it this
   * MSP's client. Apps that write into an MSP's clients (seals, templates)
   * write only where this checks out, whatever the server lists.
   */
  clientSeal(joinKey: Uint8Array, organizationId: string, mspId: string): Promise<string> {
    return this.sign(joinKey, this.clientParts(organizationId, mspId));
  }

  checkClientSeal(
    seal: string | null | undefined,
    joinKey: Uint8Array,
    organizationId: string,
    mspId: string,
  ): Promise<boolean> {
    return this.verify(joinKey, this.clientParts(organizationId, mspId), seal);
  }

  /** An organization's joining setting and email domains, as an owner or admin saved them. */
  joiningSeal(
    joinKey: Uint8Array,
    organizationId: string,
    autoConfirm: boolean,
    domains: readonly string[],
  ): Promise<string> {
    return this.sign(joinKey, this.joiningParts(organizationId, autoConfirm, domains));
  }

  checkJoiningSeal(
    seal: string | null | undefined,
    joinKey: Uint8Array,
    organizationId: string,
    autoConfirm: boolean,
    domains: readonly string[],
  ): Promise<boolean> {
    return this.verify(joinKey, this.joiningParts(organizationId, autoConfirm, domains), seal);
  }

  private async proofParts(organizationId: string, userId: string, userPublicKey: Uint8Array) {
    return joinParts([
      "passbundle join v1",
      organizationId,
      userId,
      new Uint8Array(await this.sha256(userPublicKey)),
    ]);
  }

  private expiringParts(
    kind: "invite" | "staff",
    organizationId: string,
    email: string,
    expires: number,
    nonce: string,
  ) {
    return joinParts([
      `passbundle ${kind} v2`,
      organizationId,
      email.toLowerCase(),
      String(expires),
      nonce,
    ]);
  }

  private clientParts(organizationId: string, mspId: string) {
    return joinParts(["passbundle msp client v1", organizationId, mspId]);
  }

  private newExpiringSeal(
    kind: "invite" | "staff",
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
    now: Date,
  ): Promise<string> {
    const nonce = toB64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    return this.expiringSeal(
      kind,
      joinKey,
      organizationId,
      email,
      seconds(now) + SEAL_LIFETIME_SECONDS,
      nonce,
    );
  }

  /**
   * An expiring seal vouches while `now` is before its end, if its end isn't
   * further ahead than any seal is made for, and its MAC covers this kind,
   * organization, email, end, and nonce. A version 1 seal, which never ends,
   * doesn't.
   */
  private async checkExpiringSeal(
    kind: "invite" | "staff",
    seal: string | null | undefined,
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
    now: Date,
  ): Promise<boolean> {
    const parsed = parseExpiringSeal(seal);
    if (
      parsed == null ||
      parsed.expires <= seconds(now) ||
      parsed.expires > seconds(now) + SEAL_MAX_AHEAD_SECONDS
    ) {
      return false;
    }
    const data = this.expiringParts(kind, organizationId, email, parsed.expires, parsed.nonce);
    const mac = fromB64(seal!.slice(seal!.lastIndexOf(".") + 1));
    if (mac == null || mac.length !== 32) {
      return false;
    }
    return this.subtle.verify("HMAC", await this.hmacKey(joinKey, "verify"), mac, data);
  }

  private joiningParts(organizationId: string, autoConfirm: boolean, domains: readonly string[]) {
    return joinParts([
      "passbundle joining v1",
      organizationId,
      autoConfirm ? "1" : "0",
      [...domains].sort().join(","),
    ]);
  }

  private secretBytes(secret: string): Uint8Array {
    const bytes = JOIN_SECRET.test(secret) ? fromB64(secret) : null;
    if (bytes == null || bytes.length !== 32) {
      throw new Error("That join secret isn't one.");
    }
    return bytes;
  }

  private sha256(data: Uint8Array) {
    return this.subtle.digest("SHA-256", copy(data));
  }

  private async hmacKey(key: Uint8Array, use: KeyUsage) {
    return this.subtle.importKey("raw", copy(key), { name: "HMAC", hash: "SHA-256" }, false, [use]);
  }

  private async mac(key: Uint8Array, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    return new Uint8Array(await this.subtle.sign("HMAC", await this.hmacKey(key, "sign"), data));
  }

  private async sign(key: Uint8Array, data: Uint8Array<ArrayBuffer>): Promise<string> {
    return toB64(await this.mac(key, data));
  }

  /** Checks a seal in constant time (WebCrypto's verify). A missing or malformed one fails. */
  private async verify(
    key: Uint8Array,
    data: Uint8Array<ArrayBuffer>,
    seal: string | null | undefined,
  ): Promise<boolean> {
    const mac = seal == null ? null : fromB64(seal);
    if (mac == null || mac.length !== 32) {
      return false;
    }
    return this.subtle.verify("HMAC", await this.hmacKey(key, "verify"), mac, data);
  }
}
