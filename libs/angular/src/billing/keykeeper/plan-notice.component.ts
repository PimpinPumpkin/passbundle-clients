import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { I18nPipe } from "@bitwarden/ui-common";

import { KeykeeperPlanSentence } from "./plan-notice";
import { KeykeeperPricingLinkComponent } from "./pricing-link.component";

/**
 * Keykeeper: one plain sentence saying what the plan doesn't include, and a
 * link to the website's Pricing page (DESIGN.md, "Plans and billing"). It
 * stands where upstream sent people to a purchase page this server never had.
 * Our own Plan page will take the link's place when it exists.
 */
@Component({
  selector: "billing-keykeeper-plan-notice",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe, KeykeeperPricingLinkComponent],
  template: `
    <span data-testid="keykeeper-plan-notice" [attr.data-sentence]="sentence()">
      {{ sentence() | i18n }}
      <billing-keykeeper-pricing-link />
    </span>
  `,
})
export class KeykeeperPlanNoticeComponent {
  readonly sentence = input.required<KeykeeperPlanSentence>();
}
