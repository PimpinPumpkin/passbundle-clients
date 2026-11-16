import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { combineLatest, map, of, switchMap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { ownPlan$ } from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import {
  KEYKEEPER_PLAN_BANNERS_PUT_AWAY,
  KeykeeperPlanBanner,
  planBanners,
  planBannerWords,
  putAwayToday,
  withPutAway,
} from "@bitwarden/common/billing/keykeeper/plan-banners";
import { dateInWords, translateWith } from "@bitwarden/common/billing/keykeeper/plan-words";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { UserId } from "@bitwarden/common/types/guid";
import { BannerModule, LinkModule } from "@bitwarden/components";
import { StateProvider } from "@bitwarden/state";
import { I18nPipe } from "@bitwarden/ui-common";

type Shown = {
  banner: KeykeeperPlanBanner;
  words: string;
  /** The Plan page it's about, where the person has one. */
  link: string | null;
  userId: UserId;
};

/** The Plan page a banner is about, as an address in the web vault. */
function planPagePath(banner: KeykeeperPlanBanner): string | null {
  if (!banner.planPage) {
    return null;
  }
  switch (banner.whose.kind) {
    case "person":
      return "#/settings/plan";
    case "organization":
      return `#/organizations/${encodeURIComponent(banner.whose.id)}/plan`;
    default:
      return null;
  }
}

/**
 * Keykeeper: the plan banners, in the web vault and the extension (DESIGN.md,
 * "Plans and billing", "What happens when payment stops"), from
 * `keykeeperPlan` only: a trial ending, to whoever manages the plan from 7
 * days out; a payment due, to whoever pays; and an organization's plan having
 * ended, to its owners and admins. Each links to the Plan page where the
 * person has one, and can be put away for the rest of the day. Where plans
 * aren't enforced there are none.
 */
@Component({
  selector: "billing-keykeeper-plan-banners",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BannerModule, LinkModule, I18nPipe],
  template: `
    @for (shown of banners(); track shown.banner.key) {
      <bit-banner
        [variant]="shown.banner.kind === 'trialEnding' ? 'primary' : 'warning'"
        [useAlertRole]="false"
        (dismiss)="putAway(shown)"
        data-testid="keykeeper-plan-banner"
        [attr.data-kind]="shown.banner.kind"
        [attr.data-whose]="
          shown.banner.whose.kind === 'person'
            ? 'person'
            : shown.banner.whose.kind + ':' + shown.banner.whose.id
        "
      >
        {{ shown.words }}
        @if (shown.link) {
          <a
            bitLink
            linkType="secondary"
            [href]="shown.link"
            [attr.target]="inExtension() ? '_blank' : null"
            [attr.rel]="inExtension() ? 'noreferrer' : null"
            data-testid="keykeeper-plan-banner-link"
            >{{ "keykeeperPlanSeePlan" | i18n }}</a
          >
        }
      </bit-banner>
    }
  `,
})
export class KeykeeperPlanBannersComponent {
  private readonly stateProvider = inject(StateProvider);
  private readonly organizationService = inject(OrganizationService);
  private readonly environmentService = inject(EnvironmentService);
  private readonly i18n = inject(I18nService);

  /**
   * In the extension, a banner's link opens the web vault's Plan page in a
   * new tab. In the web vault it stays in the tab.
   */
  readonly inExtension = input(false);

  private readonly date = dateInWords(this.i18n.translationLocale);
  private readonly t = translateWith(this.i18n);

  protected readonly banners = toSignal(
    combineLatest([
      inject(AccountService).activeAccount$.pipe(map((account) => account?.id ?? null)),
      toObservable(this.inExtension),
    ]).pipe(
      switchMap(([userId, inExtension]) =>
        userId == null
          ? of([] as Shown[])
          : combineLatest([
              ownPlan$(this.stateProvider, userId),
              this.organizationService.organizations$(userId),
              this.stateProvider.getUser(userId, KEYKEEPER_PLAN_BANNERS_PUT_AWAY).state$,
              inExtension
                ? this.environmentService.environment$.pipe(map((env) => env.getWebVaultUrl()))
                : of(""),
            ]).pipe(
              map(([own, organizations, putAway, webVault]) => {
                const now = new Date();
                const memberships = organizations
                  .filter((org) => org.isMember)
                  .map((org) => ({
                    id: org.id,
                    name: org.name,
                    plan: org.keykeeperPlan,
                    isOwner: org.isOwner,
                    isAdmin: org.isAdmin,
                  }));
                return planBanners(own, memberships, now)
                  .filter((banner) => !putAwayToday(putAway, banner.key, now))
                  .map((banner): Shown => {
                    const path = planPagePath(banner);
                    return {
                      banner,
                      words: planBannerWords(banner, this.t, this.date),
                      link: path == null ? null : inExtension ? `${webVault}/${path}` : path,
                      userId,
                    };
                  });
              }),
            ),
      ),
    ),
    { initialValue: [] as Shown[] },
  );

  /** Puts a banner away for the rest of the day. */
  protected async putAway(shown: Shown) {
    const state = this.stateProvider.getUser(shown.userId, KEYKEEPER_PLAN_BANNERS_PUT_AWAY);
    await state.update((putAway) => withPutAway(putAway, shown.banner.key, new Date()));
  }
}
