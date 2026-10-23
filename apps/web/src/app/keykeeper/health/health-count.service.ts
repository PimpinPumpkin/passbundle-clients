import { Injectable } from "@angular/core";
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  Observable,
  of,
  shareReplay,
  switchMap,
  timer,
} from "rxjs";

import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import {
  checksPassword,
  isWeakScore,
  needsFixing,
  passwordProblems,
  passwordScore,
} from "@bitwarden/common/dirt/keykeeper/password-health";
import { checkPasswords } from "@bitwarden/common/dirt/keykeeper/pwned-passwords";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

/** How long after unlocking before counting, so the vault shows first. */
export const HEALTH_COUNT_START_MS = 3_000;
/** How long the vault stays unchanged before counting again. */
export const HEALTH_COUNT_SETTLE_MS = 2_000;
/** Passwords scored between pauses that let the page respond. */
const SCORES_PER_PAUSE = 25;

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Keykeeper: the count beside Health in the web vault's menu: how many items
 * the person's Health would ask them to fix (a weak, reused, or exposed
 * password), by the reports' own rules (password-health.ts), so it matches
 * what Health lists. It's worked out after the vault is unlocked and showing,
 * a few passwords at a time, so it never holds anything up: weak and reused
 * first, then exposed once the k-anonymity breach check answers (only 5
 * characters of each password's SHA-1 hash leave the browser). When that
 * check can't be made, the count is weak and reused only. See DESIGN.md, "The
 * left menu".
 */
@Injectable({ providedIn: "root" })
export class KeykeeperHealthCountService {
  /** Items to fix; undefined while it's worked out, and while locked. */
  readonly count$: Observable<number | undefined>;

  /** Weak or not, by item and revision, so a recount scores only what changed. */
  private readonly weakByRevision = new Map<string, boolean>();

  constructor(
    accountService: AccountService,
    authService: AuthService,
    private readonly cipherService: CipherService,
    private readonly passwordStrengthService: PasswordStrengthServiceAbstraction,
    private readonly auditService: AuditService,
  ) {
    this.count$ = accountService.activeAccount$.pipe(
      switchMap((account) =>
        account == null
          ? of(undefined)
          : authService.authStatusFor$(account.id).pipe(
              distinctUntilChanged(),
              switchMap((status) =>
                status === AuthenticationStatus.Unlocked
                  ? this.countFor(account.id)
                  : of(undefined),
              ),
            ),
      ),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }

  private countFor(userId: UserId): Observable<number | undefined> {
    return timer(HEALTH_COUNT_START_MS).pipe(
      switchMap(() => this.cipherService.cipherViews$(userId)),
      filter((ciphers): ciphers is CipherView[] => ciphers != null),
      debounceTime(HEALTH_COUNT_SETTLE_MS),
      switchMap((ciphers) => this.count(ciphers)),
    );
  }

  /** The items to fix among these: weak and reused first, then with exposed. Never fails. */
  count(ciphers: CipherView[]): Observable<number> {
    return new Observable<number>((subscriber) => {
      let stopped = false;
      const run = async () => {
        const checked = ciphers.filter((cipher) => checksPassword(cipher, true));
        const weak = new Set<CipherView>();
        for (let i = 0; i < checked.length; i += SCORES_PER_PAUSE) {
          for (const cipher of checked.slice(i, i + SCORES_PER_PAUSE)) {
            if (this.isWeak(cipher)) {
              weak.add(cipher);
            }
          }
          await pause();
          if (stopped) {
            return;
          }
        }
        const rules = { needsEdit: true, weak: (cipher: CipherView) => weak.has(cipher) };
        subscriber.next(passwordProblems(checked, rules).filter(needsFixing).length);

        const exposed = await checkPasswords(
          checked.map((cipher) => cipher.login.password),
          (password) => this.auditService.passwordLeaked(password),
        );
        if (stopped) {
          return;
        }
        subscriber.next(
          passwordProblems(checked, { ...rules, exposed }).filter(needsFixing).length,
        );
        subscriber.complete();
      };
      run().catch(() => {
        // A count beside a menu entry isn't worth an error; Health says more.
        if (!stopped) {
          subscriber.complete();
        }
      });
      return () => {
        stopped = true;
      };
    });
  }

  private isWeak(cipher: CipherView): boolean {
    const key = `${cipher.id}:${cipher.revisionDate?.getTime() ?? ""}`;
    let weak = cipher.id == null ? undefined : this.weakByRevision.get(key);
    if (weak === undefined) {
      weak = isWeakScore(
        passwordScore(
          cipher,
          (password, hints) =>
            this.passwordStrengthService.getPasswordStrength(password, null, hints)?.score ?? null,
        ),
      );
      if (cipher.id != null) {
        this.weakByRevision.set(key, weak);
      }
    }
    return weak;
  }
}
