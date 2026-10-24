import { Injectable } from "@angular/core";
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  Observable,
  of,
  shareReplay,
  switchMap,
  timer,
} from "rxjs";

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
import { PwnedPasswordsCancelledError } from "@bitwarden/common/dirt/keykeeper/pwned-passwords";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { KeykeeperBreachCheckSetting } from "./breach-check-setting.service";
import { KeykeeperExposureChecks } from "./exposure-checks.service";

/** Items to fix, and whether the breach check couldn't be made for some of them. */
export type HealthCount = { toFix: number; couldntCheck: boolean };

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
 * check can't be made, the count is weak and reused, with a hint that it
 * couldn't check. When the person turned off "Check my passwords against
 * known breaches after unlocking", the count is weak and reused and nothing
 * is sent. See DESIGN.md, "The left menu".
 */
@Injectable({ providedIn: "root" })
export class KeykeeperHealthCountService {
  /** Items to fix; undefined while it's worked out, and while locked. */
  readonly count$: Observable<HealthCount | undefined>;

  /** Weak or not, by item and revision, so a recount scores only what changed. */
  private readonly weakByRevision = new Map<string, boolean>();

  constructor(
    accountService: AccountService,
    authService: AuthService,
    private readonly cipherService: CipherService,
    private readonly passwordStrengthService: PasswordStrengthServiceAbstraction,
    private readonly exposureChecks: KeykeeperExposureChecks,
    private readonly breachCheck: KeykeeperBreachCheckSetting,
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
      distinctUntilChanged((a, b) => a?.toFix === b?.toFix && a?.couldntCheck === b?.couldntCheck),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }

  private countFor(userId: UserId): Observable<HealthCount | undefined> {
    return timer(HEALTH_COUNT_START_MS).pipe(
      switchMap(() =>
        combineLatest([
          this.cipherService
            .cipherViews$(userId)
            .pipe(filter((ciphers): ciphers is CipherView[] => ciphers != null)),
          this.breachCheck.checksAfterUnlock$(userId),
        ]),
      ),
      debounceTime(HEALTH_COUNT_SETTLE_MS),
      switchMap(([ciphers, checkExposed]) =>
        this.count(ciphers, {
          checkExposed,
          // Read again just before each request goes out, so a check queued
          // before the setting was turned off (here or in another tab) sends
          // nothing.
          mayAsk: () => firstValueFrom(this.breachCheck.checksAfterUnlock$(userId)),
        }),
      ),
    );
  }

  /**
   * The items to fix among these: weak and reused first, then with exposed,
   * unless `checkExposed` is off. Never fails; a breach check that couldn't
   * be made is said with `couldntCheck`. Unsubscribing calls off the checks
   * still waiting.
   */
  count(
    ciphers: CipherView[],
    {
      checkExposed = true,
      mayAsk,
    }: { checkExposed?: boolean; mayAsk?: () => Promise<boolean> } = {},
  ): Observable<HealthCount> {
    return new Observable<HealthCount>((subscriber) => {
      const calledOff = new AbortController();
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
          if (calledOff.signal.aborted) {
            return;
          }
        }
        const rules = { needsEdit: true, weak: (cipher: CipherView) => weak.has(cipher) };
        const toFix = passwordProblems(checked, rules).filter(needsFixing).length;
        subscriber.next({ toFix, couldntCheck: false });
        if (!checkExposed) {
          subscriber.complete();
          return;
        }

        let exposed: Map<string, number | null>;
        try {
          exposed = await this.exposureChecks.check(checked, {
            signal: calledOff.signal,
            mayAsk,
          });
        } catch (e) {
          if (!(e instanceof PwnedPasswordsCancelledError)) {
            subscriber.next({ toFix, couldntCheck: true });
          }
          subscriber.complete();
          return;
        }
        const problems = passwordProblems(checked, { ...rules, exposed });
        subscriber.next({
          toFix: problems.filter(needsFixing).length,
          couldntCheck: problems.some((found) => found.exposed === null),
        });
        subscriber.complete();
      };
      run().catch(() => {
        // A count beside a menu entry isn't worth an error; Health says more.
        if (!calledOff.signal.aborted) {
          subscriber.complete();
        }
      });
      return () => calledOff.abort();
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
