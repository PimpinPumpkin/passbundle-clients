import { inject } from "@angular/core";
import { CanActivateFn, Router, UrlTree } from "@angular/router";
import { firstValueFrom } from "rxjs";

import {
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { DialogService } from "@bitwarden/components";

/**
 * Keykeeper: a report that's part of Premium (DESIGN.md, "Plans and
 * billing"). Without Premium the person stays on the list of reports and is
 * told so in one sentence, whether they clicked the card or typed the
 * report's address. It stands in for upstream's guard, which sent them to a
 * purchase page this server never had.
 */
export function keykeeperPremiumReportGuard(
  sentence: KeykeeperPlanSentence = KeykeeperPlanSentence.Premium,
): CanActivateFn {
  return async (): Promise<boolean | UrlTree> => {
    const router = inject(Router);
    const dialogService = inject(DialogService);
    const billingAccountProfileStateService = inject(BillingAccountProfileStateService);
    const account = await firstValueFrom(inject(AccountService).activeAccount$);

    const hasPremium =
      account != null &&
      (await firstValueFrom(
        billingAccountProfileStateService.hasPremiumFromAnySource$(account.id),
      ));
    if (hasPremium) {
      return true;
    }

    KeykeeperPlanNoticeDialogComponent.open(dialogService, { sentence });
    return router.createUrlTree(["/reports"]);
  };
}
