// Keykeeper: password health for each MSP client, for the MSP console. MSP
// staff can decrypt their clients' items, so this is computed in the browser
// and the server never sees it. Which items count, and what's weak, reused,
// and exposed, are the same rules as the Health reports'
// (libs/common/src/dirt/keykeeper/password-health.ts), with reuse counted
// within each client. Exposed comes from the k-anonymity breach check
// (pwned-passwords.ts), whose results come in by password, for one run.

import {
  checksPassword,
  isWeakScore,
  needsFixing,
  passwordProblems,
  passwordScore,
  StrengthScorer,
  usernameHints,
} from "@bitwarden/common/dirt/keykeeper/password-health";
import {
  ExpirationStatus,
  expirationStatus,
  itemExpiration,
} from "@bitwarden/common/vault/keykeeper/expiration";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

export { StrengthScorer, usernameHints };

/** An item in a client's vault whose password needs fixing, by name only: never its password. */
export type ItemToFix = {
  id: string;
  name: string;
  organizationId: string;
  weak: boolean;
  reused: boolean;
  /** Times seen in breaches; null when it couldn't be checked, undefined while the check runs. */
  exposed: number | null | undefined;
};

export type ClientHealth = {
  /** Items in the client's vault, not counting the trash. */
  items: number;
  /** Expired, or expiring within 30 days. */
  expiring: number;
  weak: number;
  /** Logins whose password is also used by another login in the same client. */
  reused: number;
  /** Logins whose password is in known breaches; undefined while the check runs. */
  exposed: number | undefined;
  /** Logins whose password couldn't be checked for breaches (offline or blocked). */
  unchecked: number;
  /** The logins to fix, the most exposed first, then the most problems, then by name. */
  toFix: ItemToFix[];
};

function isClientItem(cipher: CipherView, clients: Set<string>): boolean {
  return cipher.organizationId != null && clients.has(cipher.organizationId) && !cipher.isDeleted;
}

/** The items whose passwords the console checks for breaches, across the clients. */
export function clientItemsToCheck(ciphers: CipherView[], organizationIds: string[]): CipherView[] {
  const clients = new Set(organizationIds);
  return ciphers.filter((cipher) => isClientItem(cipher, clients) && checksPassword(cipher, false));
}

const problemCount = (item: ItemToFix) =>
  Number(item.weak) + Number(item.reused) + Number((item.exposed ?? 0) > 0);

export function clientHealth(
  ciphers: CipherView[],
  organizationIds: string[],
  score: StrengthScorer,
  today: Date = new Date(),
  exposed?: ReadonlyMap<string, number | null>,
): Map<string, ClientHealth> {
  const clients = new Set(organizationIds);
  const health = new Map<string, ClientHealth>(
    organizationIds.map((id): [string, ClientHealth] => [
      id,
      {
        items: 0,
        expiring: 0,
        weak: 0,
        reused: 0,
        exposed: exposed === undefined ? undefined : 0,
        unchecked: 0,
        toFix: [],
      },
    ]),
  );

  const inClients = ciphers.filter((cipher) => isClientItem(cipher, clients));
  for (const cipher of inClients) {
    const org = health.get(cipher.organizationId)!;
    org.items++;
    const expires = itemExpiration(cipher);
    if (expires && expirationStatus(expires, today).state !== "later") {
      org.expiring++;
    }
  }

  const problems = passwordProblems(inClients, {
    needsEdit: false,
    weak: (cipher) => isWeakScore(passwordScore(cipher, score)),
    group: (cipher) => cipher.organizationId,
    exposed,
  });
  for (const found of problems) {
    const org = health.get(found.cipher.organizationId)!;
    org.weak += Number(found.weak);
    org.reused += Number(found.reused);
    if (org.exposed !== undefined && (found.exposed ?? 0) > 0) {
      org.exposed++;
    }
    org.unchecked += Number(found.exposed === null);
    if (needsFixing(found)) {
      org.toFix.push({
        id: found.cipher.id,
        name: found.cipher.name,
        organizationId: found.cipher.organizationId,
        weak: found.weak,
        reused: found.reused,
        exposed: found.exposed,
      });
    }
  }
  for (const org of health.values()) {
    org.toFix.sort(
      (a, b) =>
        (b.exposed ?? 0) - (a.exposed ?? 0) ||
        problemCount(b) - problemCount(a) ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );
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
