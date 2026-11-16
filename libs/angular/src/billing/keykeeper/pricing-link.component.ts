import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LinkModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { pricingPageAddress } from "./plan-notice";

/**
 * Keykeeper: "See pricing", a link to the Pricing page on the website. It
 * opens in a new tab and is left out when the build has no https address for
 * the website.
 */
@Component({
  selector: "billing-keykeeper-pricing-link",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe, LinkModule],
  template: `
    @if (pricingPage) {
      <a
        bitLink
        [href]="pricingPage"
        target="_blank"
        rel="noreferrer"
        data-testid="keykeeper-pricing-link"
        >{{ "keykeeperPlanSeePricing" | i18n }}</a
      >
    }
  `,
})
export class KeykeeperPricingLinkComponent {
  protected readonly pricingPage = pricingPageAddress(
    inject(I18nService).t("keykeeperPricingPage"),
  );
}
