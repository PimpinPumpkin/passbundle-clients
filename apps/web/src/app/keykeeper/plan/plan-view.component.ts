import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { KeykeeperPricingLinkComponent } from "@bitwarden/angular/billing/keykeeper";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { KeykeeperPlanEnforced } from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import {
  dateInWords,
  planPageWords,
  PlanWhose,
  translateWith,
} from "@bitwarden/common/billing/keykeeper/plan-words";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { providerPageAddress } from "./plan-api";

/**
 * Keykeeper: one plan, on the Plan page (DESIGN.md, "Plans and billing",
 * "Upstream's billing pages go"): its name, its state and dates in words,
 * whether an MSP covers it, what it gives, and one button that opens the
 * provider's page. The button is there only when the server says the person
 * can pay; until a provider is set, it never is.
 */
@Component({
  selector: "app-keykeeper-plan-view",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, KeykeeperPricingLinkComponent],
  template: `
    @let w = words();
    <section
      class="tw-mb-8 tw-max-w-3xl"
      data-testid="keykeeper-plan"
      [attr.data-state]="plan().state ?? 'none'"
      [attr.aria-label]="'keykeeperPlanNav' | i18n"
    >
      <h2 bitTypography="h3" class="tw-mb-2" data-testid="keykeeper-plan-name">{{ w.name }}</h2>
      @for (line of w.status; track $index) {
        <p bitTypography="body1" class="tw-mb-1" data-testid="keykeeper-plan-status">
          {{ line }}
        </p>
      }
      @if (w.coveredBy) {
        <p bitTypography="body1" class="tw-mb-1" data-testid="keykeeper-plan-covered-by">
          {{ w.coveredBy }}
        </p>
      }
      @if (w.gives.length > 0) {
        <h3 bitTypography="h5" class="tw-mt-6 tw-mb-2">{{ "keykeeperPlanIncludes" | i18n }}</h3>
        <ul class="tw-ps-5 tw-mb-0" data-testid="keykeeper-plan-gives">
          @for (line of w.gives; track $index) {
            <li bitTypography="body1" class="tw-mb-1">{{ line }}</li>
          }
        </ul>
      }
      @if (w.note) {
        <p bitTypography="body1" class="tw-mt-6 tw-mb-0" data-testid="keykeeper-plan-note">
          {{ w.note }}
          @if (w.noteIsPremium) {
            <billing-keykeeper-pricing-link />
          }
        </p>
      }
      @if (w.action; as action) {
        <button
          bitButton
          buttonType="primary"
          type="button"
          class="tw-mt-6"
          data-testid="keykeeper-plan-button"
          [bitAction]="openProviderPage"
        >
          {{ action.label }}
        </button>
      }
    </section>
  `,
})
export class KeykeeperPlanViewComponent {
  private readonly i18n = inject(I18nService);
  private readonly apiService = inject(ApiService);
  private readonly platformUtils = inject(PlatformUtilsService);
  private readonly toastService = inject(ToastService);

  readonly plan = input.required<KeykeeperPlanEnforced>();
  readonly whose = input.required<PlanWhose>();
  /** A person only: the profile says Premium's features come through an organization or an MSP. */
  readonly premiumThroughOrganization = input(false);

  private readonly date = dateInWords(this.i18n.translationLocale);

  protected readonly words = computed(() =>
    planPageWords(
      this.plan(),
      this.whose(),
      translateWith(this.i18n),
      this.date,
      this.premiumThroughOrganization(),
    ),
  );

  /** Asks the server for the provider's page and opens it in a new tab. */
  protected readonly openProviderPage = async () => {
    const action = this.words().action?.action;
    if (action == null) {
      return;
    }
    try {
      const address = await providerPageAddress(this.apiService, action, this.whose(), this.plan());
      this.platformUtils.launchUri(address);
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    }
  };
}
