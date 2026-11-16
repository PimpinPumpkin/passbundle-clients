import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { firstValueFrom, switchMap } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import {
  KeykeeperPlanEnforced,
  ownPlan$,
} from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import {
  KEYKEEPER_PLAN_BANNERS_PUT_AWAY,
  planBannerWords,
  poolBanner,
  putAwayToday,
  withPutAway,
} from "@bitwarden/common/billing/keykeeper/plan-banners";
import { dateInWords, translateWith } from "@bitwarden/common/billing/keykeeper/plan-words";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { UserId } from "@bitwarden/common/types/guid";
import { StateProvider } from "@bitwarden/state";

import { SharedModule } from "../../shared";

import { poolPlan } from "./plan-api";
import { KeykeeperPlanViewComponent } from "./plan-view.component";

/**
 * Keykeeper: an MSP's pool in the MSP console, for its admins, where
 * upstream's provider portal had its Billing page (DESIGN.md, "Plans and
 * billing"): the Plan page's view of the pool, which covers every client, and
 * above it the pool's notice while its trial is ending, a payment is due, or
 * it has ended, which can be put away for the day. The sync doesn't carry
 * the pool, so it's asked for here (`GET /api/keykeeper/plan?msp=`), and only
 * where the person's own plan says plans are enforced.
 */
@Component({
  selector: "app-keykeeper-msp-plan",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, KeykeeperPlanViewComponent],
  template: `
    @if (pool(); as plan) {
      <section class="tw-mb-8" [attr.aria-label]="'keykeeperPlanNav' | i18n" data-testid="msp-plan">
        <h2 bitTypography="h3">{{ "keykeeperPlanNav" | i18n }}</h2>
        @if (notice(); as words) {
          <bit-callout
            [type]="noticeKind() === 'trialEnding' ? 'info' : 'warning'"
            [title]="null"
            (dismiss)="putAway()"
            data-testid="keykeeper-plan-banner"
            [attr.data-kind]="noticeKind()"
            [attr.data-whose]="'msp:' + mspId()"
          >
            {{ words }}
          </bit-callout>
        }
        <app-keykeeper-plan-view [plan]="plan" [whose]="whose()" />
      </section>
    }
  `,
})
export class KeykeeperMspPlanComponent {
  private readonly apiService = inject(ApiService);
  private readonly stateProvider = inject(StateProvider);
  private readonly i18n = inject(I18nService);

  readonly mspId = input.required<string>();
  readonly mspName = input.required<string>();

  protected readonly whose = computed(() => ({
    kind: "msp" as const,
    id: this.mspId(),
    name: this.mspName(),
  }));

  private readonly userId = toSignal(inject(AccountService).activeAccount$.pipe(getUserId));
  protected readonly pool = signal<KeykeeperPlanEnforced | null>(null);
  private readonly putAwayList = toSignal(
    inject(AccountService).activeAccount$.pipe(
      getUserId,
      switchMap(
        (userId) => this.stateProvider.getUser(userId, KEYKEEPER_PLAN_BANNERS_PUT_AWAY).state$,
      ),
    ),
  );

  private readonly banner = computed(() => {
    const plan = this.pool();
    if (plan == null) {
      return null;
    }
    const now = new Date();
    const banner = poolBanner(plan, { id: this.mspId(), name: this.mspName() }, now);
    return banner == null || putAwayToday(this.putAwayList(), banner.key, now) ? null : banner;
  });
  protected readonly noticeKind = computed(() => this.banner()?.kind ?? null);
  protected readonly notice = computed(() => {
    const banner = this.banner();
    return banner == null
      ? null
      : planBannerWords(banner, translateWith(this.i18n), dateInWords(this.i18n.translationLocale));
  });

  constructor() {
    effect(() => {
      const mspId = this.mspId();
      const userId = this.userId();
      if (userId != null) {
        void this.load(userId, mspId);
      }
    });
  }

  private async load(userId: UserId, mspId: string) {
    const own = await firstValueFrom(ownPlan$(this.stateProvider, userId));
    if (!own.enforced) {
      this.pool.set(null);
      return;
    }
    try {
      const plan = await poolPlan(this.apiService, mspId);
      this.pool.set(plan.enforced ? plan : null);
    } catch {
      // Someone who doesn't manage the pool is told it isn't there.
      this.pool.set(null);
    }
  }

  protected async putAway() {
    const banner = this.banner();
    const userId = this.userId();
    if (banner == null || userId == null) {
      return;
    }
    await this.stateProvider
      .getUser(userId, KEYKEEPER_PLAN_BANNERS_PUT_AWAY)
      .update((putAway) => withPutAway(putAway, banner.key, new Date()));
  }
}
