// Keykeeper: how healthy someone's own passwords are, in numbers only, for
// their organizations' owners and admins (DESIGN.md, "Members' own
// passwords"). The logins in the person's Personal items are counted by
// Health's own rules (password-health.ts), and only four numbers go to the
// server: how many, how many weak, reused, and exposed. Never which items.
// Only while an organization they've joined has "Members' own passwords" on:
// the server says which do (`seen-by`), and the person is told by name.

import {
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  firstValueFrom,
  map,
  Observable,
  of,
  Subscription,
  switchMap,
  timer,
} from "rxjs";

import { ApiService } from "../../abstractions/api.service";
import { OrganizationService } from "../../admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationUserStatusType } from "../../admin-console/enums";
import { AccountService } from "../../auth/abstractions/account.service";
import { AuthService } from "../../auth/abstractions/auth.service";
import { AuthenticationStatus } from "../../auth/enums/authentication-status";
import { getOptionalUserId } from "../../auth/services/account.service";
import { LogService } from "../../platform/abstractions/log.service";
import { UserId } from "../../types/guid";
import { CipherService } from "../../vault/abstractions/cipher.service";
import { CipherView } from "../../vault/models/view/cipher.view";

import {
  checksPassword,
  isWeakScore,
  passwordProblems,
  passwordScore,
  StrengthScorer,
} from "./password-health";

/** What a member's app reports about their own logins. */
export type OwnHealthCounts = {
  logins: number;
  weak: number;
  reused: number;
  /** Only when every one of the logins was checked against known breaches. */
  exposed?: number;
};

const PATH = "/keykeeper/own-health";
const SEEN_BY_PATH = "/keykeeper/own-health/seen-by";

/** An organization whose owners and admins see someone's numbers. */
export type OwnHealthSeenBy = { id: string; name: string };

/**
 * The organizations whose owners and admins see someone's numbers: those
 * they've joined that have "Members' own passwords" on, by name. Null from a
 * server that doesn't have it.
 */
export async function ownHealthSeenBy(apiService: ApiService): Promise<OwnHealthSeenBy[] | null> {
  try {
    const response: { data?: OwnHealthSeenBy[] } = await apiService.send(
      "GET",
      SEEN_BY_PATH,
      null,
      true,
      true,
    );
    return (response?.data ?? []).map(({ id, name }) => ({ id, name }));
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 405) {
      return null;
    }
    throw e;
  }
}

/** Names in a sentence: "A", "A and B", or "A, B, and C". */
export function organizationNames(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * The numbers for the logins in someone's Personal items (no organization)
 * that Health checks: a password they may see, not in the trash. Reused is
 * within those logins. Exposed only when `exposed` (the breach check's
 * results, by password) has an answer for every one of them.
 */
export function ownHealthCounts(
  ciphers: CipherView[],
  weak: (cipher: CipherView) => boolean,
  exposed?: ReadonlyMap<string, number | null>,
): OwnHealthCounts {
  const own = ciphers.filter(
    (cipher) => cipher.organizationId == null && checksPassword(cipher, false),
  );
  const problems = passwordProblems(own, { needsEdit: false, weak, exposed });
  const counts: OwnHealthCounts = {
    logins: problems.length,
    weak: problems.filter((p) => p.weak).length,
    reused: problems.filter((p) => p.reused).length,
  };
  if (exposed !== undefined && problems.every((p) => p.exposed != null)) {
    counts.exposed = problems.filter((p) => (p.exposed ?? 0) > 0).length;
  }
  return counts;
}

/** Whether someone is a confirmed member of an organization, whose admins see the numbers. */
export function confirmedMemberOfAny(
  organizationService: OrganizationService,
  userId: UserId,
): Observable<boolean> {
  return organizationService
    .organizations$(userId)
    .pipe(
      map((organizations) =>
        organizations.some((o) => o.status === OrganizationUserStatusType.Confirmed),
      ),
    );
}

/**
 * Sends someone's numbers to the server: once per unlock and again when they
 * change, only while an organization they've joined sees them (it asks the
 * server first, and not at all for someone who isn't a confirmed member of
 * any), and never again in this session after the server says it doesn't
 * have the endpoint. It never fails: the numbers are worth less than any
 * error.
 */
export class KeykeeperOwnHealthReporter {
  /** What was last sent, by account, so the same numbers aren't sent again. */
  private readonly sent = new Map<UserId, string>();
  private unheard = false;

  constructor(
    private readonly apiService: ApiService,
    private readonly organizationService: OrganizationService,
    private readonly logService: LogService,
  ) {}

  async report(userId: UserId, counts: OwnHealthCounts): Promise<boolean> {
    const text = JSON.stringify(counts);
    if (this.unheard || this.sent.get(userId) === text) {
      return false;
    }
    try {
      if (!(await firstValueFrom(confirmedMemberOfAny(this.organizationService, userId)))) {
        return false;
      }
      const seenBy = await ownHealthSeenBy(this.apiService);
      if (seenBy == null) {
        this.unheard = true;
        return false;
      }
      if (seenBy.length === 0) {
        return false;
      }
      const answer: { kept?: boolean } | null = await this.apiService.send(
        "PUT",
        PATH,
        counts,
        true,
        true,
      );
      // An organization turned it off in the meantime: the server didn't keep them.
      if (answer?.kept === false) {
        return false;
      }
      this.sent.set(userId, text);
      return true;
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 405) {
        this.unheard = true;
      } else {
        this.logService.warning(`Couldn't report your own passwords' numbers: ${String(e)}`);
      }
      return false;
    }
  }

  /** Forgets what was sent, as at locking: the next unlock sends again. */
  forget(userId: UserId) {
    this.sent.delete(userId);
  }
}

/** How long after unlocking before counting, so the vault shows first. */
export const OWN_HEALTH_START_MS = 10_000;
/** How long the items stay unchanged before counting again. */
export const OWN_HEALTH_SETTLE_MS = 5_000;
/** Passwords scored between pauses. */
const SCORES_PER_PAUSE = 25;

/**
 * Where nothing else counts Health (the browser extension's background):
 * while someone's unlocked, counts their own logins' weak and reused
 * passwords after unlocking and when their items change, and reports them.
 * It doesn't check breaches; the web vault's report does that.
 */
export class KeykeeperOwnHealthWatch {
  constructor(
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly cipherService: CipherService,
    private readonly score: StrengthScorer,
    private readonly reporter: KeykeeperOwnHealthReporter,
    private readonly startMs = OWN_HEALTH_START_MS,
    private readonly settleMs = OWN_HEALTH_SETTLE_MS,
  ) {}

  start(): Subscription {
    return this.accountService.activeAccount$
      .pipe(
        getOptionalUserId,
        switchMap((userId) =>
          userId == null
            ? of(null)
            : this.authService
                .authStatusFor$(userId)
                .pipe(map((status) => (status === AuthenticationStatus.Unlocked ? userId : null))),
        ),
        distinctUntilChanged(),
        switchMap((userId) => (userId == null ? EMPTY : this.follow(userId))),
      )
      .subscribe();
  }

  private follow(userId: UserId): Observable<unknown> {
    this.reporter.forget(userId);
    return timer(this.startMs).pipe(
      switchMap(() =>
        this.cipherService
          .cipherViews$(userId)
          .pipe(filter((ciphers): ciphers is CipherView[] => ciphers != null)),
      ),
      debounceTime(this.settleMs),
      switchMap(async (ciphers) => {
        const counts = await this.count(ciphers);
        await this.reporter.report(userId, counts);
      }),
    );
  }

  /** Weak and reused, a few passwords at a time so the extension stays responsive. */
  async count(ciphers: CipherView[]): Promise<OwnHealthCounts> {
    const own = ciphers.filter(
      (cipher) => cipher.organizationId == null && checksPassword(cipher, false),
    );
    const weak = new Set<CipherView>();
    for (let i = 0; i < own.length; i += SCORES_PER_PAUSE) {
      for (const cipher of own.slice(i, i + SCORES_PER_PAUSE)) {
        if (isWeakScore(passwordScore(cipher, this.score))) {
          weak.add(cipher);
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return ownHealthCounts(own, (cipher) => weak.has(cipher));
  }
}
