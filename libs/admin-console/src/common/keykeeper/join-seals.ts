// Keykeeper: the computations behind "Joins a hacked server can't forge"
// (DESIGN.md), version 1. Each one is an HMAC-SHA256 over its parts joined
// with a zero byte, under a key the server never has: the organization's join
// key (made from the organization key) for seals, and the install command's
// join secret for join proofs. Every client must compute these exactly as the
// vectors in the meta repo's docs/vectors/joins-v1.json, which the unit tests
// check (a copy sits next to them).

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

  /** That an owner or admin invited this email. */
  inviteSeal(joinKey: Uint8Array, organizationId: string, email: string): Promise<string> {
    return this.sign(joinKey, this.inviteParts(organizationId, email));
  }

  checkInviteSeal(
    seal: string | null | undefined,
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
  ): Promise<boolean> {
    return this.verify(joinKey, this.inviteParts(organizationId, email), seal);
  }

  /** That an MSP admin made this email staff with a place in this client. */
  staffSeal(joinKey: Uint8Array, organizationId: string, email: string): Promise<string> {
    return this.sign(joinKey, this.staffParts(organizationId, email));
  }

  checkStaffSeal(
    seal: string | null | undefined,
    joinKey: Uint8Array,
    organizationId: string,
    email: string,
  ): Promise<boolean> {
    return this.verify(joinKey, this.staffParts(organizationId, email), seal);
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

  private inviteParts(organizationId: string, email: string) {
    return joinParts(["passbundle invite v1", organizationId, email.toLowerCase()]);
  }

  private staffParts(organizationId: string, email: string) {
    return joinParts(["passbundle staff v1", organizationId, email.toLowerCase()]);
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

  private async sign(key: Uint8Array, data: Uint8Array<ArrayBuffer>): Promise<string> {
    return toB64(
      new Uint8Array(await this.subtle.sign("HMAC", await this.hmacKey(key, "sign"), data)),
    );
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
