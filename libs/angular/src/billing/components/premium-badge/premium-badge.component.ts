import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";

import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { BitIconButtonComponent, ChipActionComponent, DialogService } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { NotPremiumDirective } from "../../directives/not-premium.directive";
import { KeykeeperPlanSentence } from "../../keykeeper/plan-notice";
import { KeykeeperPlanNoticeDialogComponent } from "../../keykeeper/plan-notice-dialog.component";

@Component({
  selector: "app-premium-badge",
  template: `
    @if (iconOnly()) {
      <button
        type="button"
        buttonType="side-nav"
        size="xsmall"
        *appNotPremium
        bitIconButton="bwi-premium"
        [label]="'upgradeToPremium' | i18n"
        (click)="promptForPremium($event)"
      ></button>
    } @else {
      <button
        type="button"
        *appNotPremium
        bit-chip-action
        startIcon="bwi-premium"
        [variant]="'accent-primary'"
        (click)="promptForPremium($event)"
        [label]="'upgrade' | i18n"
      ></button>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe, BitIconButtonComponent, ChipActionComponent, NotPremiumDirective],
})
export class PremiumBadgeComponent {
  readonly organizationId = input<string>();
  protected readonly iconOnly = input<boolean>(false);
  /**
   * Keykeeper: the sentence this badge says when pressed, where the thing
   * beside it has one of its own ("Attaching files is part of Premium.").
   * Without it the badge says the general one.
   */
  readonly sentence = input<KeykeeperPlanSentence>();
  private readonly premiumUpgradePromptService = inject(PremiumUpgradePromptService);
  private readonly dialogService = inject(DialogService, { optional: true });

  async promptForPremium(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    const sentence = this.sentence();
    if (sentence != null && this.dialogService != null) {
      KeykeeperPlanNoticeDialogComponent.open(this.dialogService, { sentence });
      return;
    }
    await this.premiumUpgradePromptService.promptForPremium(this.organizationId());
  }
}
