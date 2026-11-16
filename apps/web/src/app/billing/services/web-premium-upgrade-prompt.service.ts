import { Injectable } from "@angular/core";
import { EMPTY, firstValueFrom, Observable } from "rxjs";

import {
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { DialogService } from "@bitwarden/components";

/**
 * Keykeeper: upstream's prompt sent people to its purchase pages and its
 * organization Billing pages, which call a billing API this server never had.
 * Those pages are gone (DESIGN.md, "Plans and billing"). Until our own Plan
 * page exists, the prompt says one plain sentence with a link to the Pricing
 * page on the website, and never navigates or closes the window it's in.
 */
@Injectable()
export class WebVaultPremiumUpgradePromptService implements PremiumUpgradePromptService {
  /** Nothing is ever bought here, so no upgrade is ever confirmed. */
  readonly upgradeConfirmed$: Observable<boolean> = EMPTY;

  constructor(
    private dialogService: DialogService,
    private accountService: AccountService,
    private billingAccountProfileStateService: BillingAccountProfileStateService,
  ) {}

  async promptForPremium(organizationId?: OrganizationId) {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    if (!account) {
      return;
    }
    const hasPremium = await firstValueFrom(
      this.billingAccountProfileStateService.hasPremiumFromAnySource$(account.id),
    );
    if (hasPremium) {
      // Already has premium, don't prompt
      return;
    }

    KeykeeperPlanNoticeDialogComponent.open(this.dialogService, {
      sentence: organizationId
        ? KeykeeperPlanSentence.OrganizationPlan
        : KeykeeperPlanSentence.Premium,
    });
  }
}
