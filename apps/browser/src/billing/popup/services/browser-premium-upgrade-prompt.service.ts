import { inject } from "@angular/core";
import { EMPTY, Observable } from "rxjs";

import {
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { DialogService } from "@bitwarden/components";

/**
 * This class handles the premium upgrade process for the browser extension.
 *
 * Keykeeper: upstream's upgrade window sent people to a purchase page this
 * server never had (DESIGN.md, "Plans and billing"). Until our own Plan page
 * exists, the prompt says one plain sentence with a link to the Pricing page
 * on the website.
 */
export class BrowserPremiumUpgradePromptService implements PremiumUpgradePromptService {
  private dialogService = inject(DialogService);

  readonly upgradeConfirmed$: Observable<boolean> = EMPTY;

  async promptForPremium() {
    KeykeeperPlanNoticeDialogComponent.open(this.dialogService, {
      sentence: KeykeeperPlanSentence.Premium,
    });
  }
}
