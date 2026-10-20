// Keykeeper: password health for each MSP client, for the MSP console. MSP
// staff can decrypt their clients' items, so this is computed in the browser
// and the server never sees it. Weak uses the same rule as upstream's weak
// passwords report: the username's parts are hints, and a score of 2 or less
// out of 4 is weak.

import { CipherType } from "@bitwarden/common/vault/enums";
import {
  ExpirationStatus,
  expirationStatus,
  itemExpiration,
} from "@bitwarden/common/vault/keykeeper/expiration";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

export type ClientHealth = {
  /** Items in the client's vault, not counting the trash. */
  items: number;
  /** Expired, or expiring within 30 days. */
  expiring: number;
  weak: number;
  /** Logins whose password is also used by another login in the same client. */
  reused: number;
};

/** A password's strength score from 0 to 4, given hints that make it weaker. */
export type StrengthScorer = (password: string, hints: string[] | null) => number | null;

/** The parts of a username that make a password easier to guess, as upstream's report uses them. */
export function usernameHints(username: string | null | undefined): string[] {
  const trimmed = (username ?? "").trim().toLowerCase();
  const local = trimmed.includes("@") ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  return local.split(/[^A-Za-z0-9]/).filter((part) => part.length >= 3);
}

export function clientHealth(
  ciphers: CipherView[],
  organizationIds: string[],
  score: StrengthScorer,
  today: Date = new Date(),
): Map<string, ClientHealth> {
  const health = new Map<string, ClientHealth>(
    organizationIds.map((id) => [id, { items: 0, expiring: 0, weak: 0, reused: 0 }]),
  );
  const passwordUses = new Map<string, Map<string, number>>();

  for (const cipher of ciphers) {
    const org = cipher.organizationId ? health.get(cipher.organizationId) : undefined;
    if (org == null || cipher.isDeleted) {
      continue;
    }
    org.items++;

    const expires = itemExpiration(cipher);
    if (expires && expirationStatus(expires, today).state !== "later") {
      org.expiring++;
    }

    const password = cipher.type === CipherType.Login ? cipher.login?.password : null;
    if (!password) {
      continue;
    }
    const hints = usernameHints(cipher.login.username);
    const strength = score(password, hints.length > 0 ? hints : null);
    if (strength != null && strength <= 2) {
      org.weak++;
    }
    const uses = passwordUses.get(cipher.organizationId) ?? new Map<string, number>();
    uses.set(password, (uses.get(password) ?? 0) + 1);
    passwordUses.set(cipher.organizationId, uses);
  }

  for (const [orgId, uses] of passwordUses) {
    health.get(orgId)!.reused = [...uses.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
  }
  return health;
}

/** An item in a client's vault that has expired or expires soon. */
export type ExpiringItem = {
  id: string;
  name: string;
  organizationId: string;
  client: string;
  expires: Date;
  status: ExpirationStatus;
};

/**
 * Every item in the clients' vaults that has expired or expires within 30
 * days, soonest first (the longest expired at the top), so an MSP sees what
 * to renew across all its clients in one list. See DESIGN.md, "Expiration
 * dates" (MSP view).
 */
export function expiringItems(
  ciphers: CipherView[],
  clients: { id: string; name: string }[],
  today: Date = new Date(),
): ExpiringItem[] {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const found: ExpiringItem[] = [];
  for (const cipher of ciphers) {
    const client = cipher.organizationId ? names.get(cipher.organizationId) : undefined;
    const expires = itemExpiration(cipher);
    if (client == null || cipher.isDeleted || expires == null) {
      continue;
    }
    const status = expirationStatus(expires, today);
    if (status.state !== "later") {
      found.push({
        id: cipher.id,
        name: cipher.name,
        organizationId: cipher.organizationId,
        client,
        expires,
        status,
      });
    }
  }
  return found.sort(
    (a, b) =>
      a.expires.getTime() - b.expires.getTime() ||
      a.client.localeCompare(b.client) ||
      a.name.localeCompare(b.name),
  );
}
