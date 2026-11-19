// Keykeeper: a family's invite link (DESIGN.md, "A family's invite link").
// The link is the web vault's address with the family's organization id, a
// token for the server, and a join secret the server never sees (it's after
// the `#`, which browsers don't send). An owner's or admin's browser makes
// both, and keeps the link's settings on the server encrypted with the
// family's key, so owners and admins can show the link again and their apps
// can check, without trusting the server, whether the link lets people in on
// its own. Nothing here is new crypto: the settings are an upstream EncString
// under the organization key, the join proof is the install command's
// (join-seals.ts), and settings are ordered as version 3 joining seals are
// (joining-memory.ts).

import {
  KEYKEEPER_JOINS_DISK,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { UserId } from "@bitwarden/common/types/guid";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import { JOIN_SECRET, JoiningMark, joiningSealedAt, KeykeeperJoinSeals } from "./join-seals";
import { newestSeen, seeNewest } from "./joining-memory";
import { PendingMember } from "./msp-types";

/** The one sentence that says what automatic means, wherever approval is chosen. */
export const FAMILY_LINK_AUTOMATIC = "Anyone who has the link gets in without you.";

/** How long a link works, in days, as the owner picks it; 7 unless they pick another. */
export const FAMILY_LINK_DAYS = [1, 7, 30] as const;
export const FAMILY_LINK_DEFAULT_DAYS = 7;

/** The join page's route in the web vault. */
export const FAMILY_JOIN_PATH = "family-join";

const ORGANIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{22}$/;

/**
 * A link's settings, as the browser that saved them sealed them. When the
 * link is off, there's no token or secret and approval isn't automatic.
 */
export type FamilyLinkSettings = {
  v: 1;
  organizationId: string;
  on: boolean;
  token: string | null;
  secret: string | null;
  automatic: boolean;
  /** When the link stops working, in Unix seconds; null while it's off. */
  expiresAt: number | null;
  /** When these settings were sealed, in Unix seconds, and a random nonce: their order. */
  sealedAt: number;
  nonce: string;
};

/** What a link carries, read from its address. */
export type FamilyLinkParts = { organizationId: string; token: string; secret: string };

/** The link: the web vault's join page with the family's id, the token, and the join secret. */
export function familyLinkAddress(webVaultUrl: string, parts: FamilyLinkParts): string {
  const query = new URLSearchParams({ o: parts.organizationId, t: parts.token, s: parts.secret });
  return `${webVaultUrl.replace(/\/+$/, "")}/#/${FAMILY_JOIN_PATH}?${query.toString()}`;
}

/** A link's parts from the join page's query, or null unless all three look right. */
export function readFamilyLink(query: Record<string, unknown>): FamilyLinkParts | null {
  const { o, t, s } = query;
  if (
    typeof o !== "string" ||
    typeof t !== "string" ||
    typeof s !== "string" ||
    !ORGANIZATION_ID.test(o) ||
    !JOIN_SECRET.test(t) ||
    !JOIN_SECRET.test(s)
  ) {
    return null;
  }
  return { organizationId: o.toLowerCase(), token: t, secret: s };
}

/** Settings read back from their JSON, or null unless they're exactly a link's. */
function parseSettings(json: string): FamilyLinkSettings | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (value == null || typeof value !== "object") {
    return null;
  }
  const s = value as Record<string, unknown>;
  const whole = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
  if (
    s.v !== 1 ||
    typeof s.organizationId !== "string" ||
    typeof s.on !== "boolean" ||
    typeof s.automatic !== "boolean" ||
    !whole(s.sealedAt) ||
    typeof s.nonce !== "string" ||
    !NONCE.test(s.nonce)
  ) {
    return null;
  }
  const on =
    s.on &&
    typeof s.token === "string" &&
    JOIN_SECRET.test(s.token) &&
    typeof s.secret === "string" &&
    JOIN_SECRET.test(s.secret) &&
    whole(s.expiresAt);
  const off =
    !s.on && s.token === null && s.secret === null && s.expiresAt === null && !s.automatic;
  return on || off ? (s as FamilyLinkSettings) : null;
}

/**
 * The newest settings this device has seen for each family's link, by
 * organization id: ones it opened with the family's key, or ones it sealed
 * that the server took. Kept past sign-out, like the newest joining seals.
 */
export const KEYKEEPER_FAMILY_LINK_SEEN = new UserKeyDefinition<Record<string, JoiningMark>>(
  KEYKEEPER_JOINS_DISK,
  "familyLinkSeen",
  {
    deserializer: (seen) => seen ?? {},
    clearOn: [],
  },
);

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const fromB64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export class KeykeeperFamilyLinks {
  constructor(
    private readonly encryptService: EncryptService,
    private readonly stateProvider: StateProvider,
    private readonly seals = new KeykeeperJoinSeals(),
  ) {}

  /** A new token or join secret: 32 random bytes, base64url. */
  newRandom(): string {
    return this.seals.newJoinSecret();
  }

  /** A new nonce for settings: 16 random bytes, base64url. */
  newNonce(): string {
    return btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(16))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  /** Settings encrypted with the family's key, for the server to keep. */
  async seal(settings: FamilyLinkSettings, organizationKey: SymmetricCryptoKey): Promise<string> {
    const sealed = await this.encryptService.encryptString(
      JSON.stringify(settings),
      organizationKey,
    );
    return sealed.encryptedString as string;
  }

  /**
   * Settings the server keeps, opened with the family's key: null unless they
   * decrypt, are exactly a link's, and are for this organization.
   */
  async open(
    sealed: string | null | undefined,
    organizationKey: SymmetricCryptoKey,
    organizationId: string,
  ): Promise<FamilyLinkSettings | null> {
    if (sealed == null) {
      return null;
    }
    let json: string;
    try {
      json = await this.encryptService.decryptString(new EncString(sealed), organizationKey);
    } catch {
      return null;
    }
    const settings = parseSettings(json);
    return settings?.organizationId.toLowerCase() === organizationId.toLowerCase()
      ? settings
      : null;
  }

  /**
   * Whether these settings (already opened) are current on this device: not
   * older than the newest it has seen for the family. Newer ones become the
   * newest.
   */
  current(userId: UserId, settings: FamilyLinkSettings): Promise<boolean> {
    return seeNewest(
      this.stateProvider,
      KEYKEEPER_FAMILY_LINK_SEEN,
      userId,
      settings.organizationId.toLowerCase(),
      { sealedAt: settings.sealedAt, nonce: settings.nonce },
    );
  }

  /** When to seal a change: now, or just after the newest settings seen for the family. */
  async sealedAt(userId: UserId, organizationId: string, now: Date = new Date()): Promise<number> {
    const seen = await newestSeen(this.stateProvider, KEYKEEPER_FAMILY_LINK_SEEN, userId);
    return joiningSealedAt(now, seen[organizationId.toLowerCase()]?.sealedAt);
  }

  /** Remembers the settings the server reports for a family, if they open and are newer. */
  async learn(
    userId: UserId,
    organizationId: string,
    sealed: string | null | undefined,
    organizationKey: SymmetricCryptoKey,
  ): Promise<void> {
    const settings = await this.open(sealed, organizationKey, organizationId);
    if (settings != null) {
      await this.current(userId, settings);
    }
  }

  /**
   * Whether an app may let in, on its own, someone who joined with the
   * family's link: the link's settings open with the family's key, are
   * current on this device, and say the link is on, automatic, and hasn't
   * ended; and the join's proof checks out against the link's join secret
   * and the public key the app is about to encrypt to. Anything else waits
   * for an owner's or admin's tap.
   */
  async vouches(
    userId: UserId,
    p: PendingMember,
    organizationKey: SymmetricCryptoKey,
    now: Date = new Date(),
  ): Promise<boolean> {
    const link = p.familyLink;
    if (link?.sealed == null || link.joinProof == null) {
      return false;
    }
    const settings = await this.open(link.sealed, organizationKey, p.organizationId);
    if (settings == null || !(await this.current(userId, settings))) {
      return false;
    }
    if (
      !settings.on ||
      !settings.automatic ||
      settings.secret == null ||
      settings.expiresAt == null ||
      settings.expiresAt <= seconds(now)
    ) {
      return false;
    }
    return this.seals.checkJoinProof(
      link.joinProof,
      settings.secret,
      p.organizationId,
      p.userId,
      fromB64(p.publicKey),
    );
  }
}
