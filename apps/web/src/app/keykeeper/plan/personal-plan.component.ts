import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { combineLatest, map, switchMap } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { ownPlan$ } from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import { StateProvider } from "@bitwarden/state";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

import { KeykeeperPlanViewComponent } from "./plan-view.component";

/**
 * Keykeeper: a person's Plan page, in Settings where upstream's Subscription
 * page was (DESIGN.md, "Plans and billing"): their own plan, Free or
 * Premium, as their last sync told it.
 */
@Component({
  selector: "app-keykeeper-personal-plan",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule, KeykeeperPlanViewComponent],
  template: `
    <app-header></app-header>
    <bit-container>
      @if (page(); as p) {
        @if (p.plan.enforced ? p.plan : null; as plan) {
          <app-keykeeper-plan-view
            [plan]="plan"
            [whose]="{ kind: 'person' }"
            [premiumThroughOrganization]="p.throughOrganization"
          />
        }
      }
    </bit-container>
  `,
})
export class KeykeeperPersonalPlanComponent {
  private readonly stateProvider = inject(StateProvider);
  private readonly billing = inject(BillingAccountProfileStateService);

  protected readonly page = toSignal(
    inject(AccountService).activeAccount$.pipe(
      getUserId,
      switchMap((userId) =>
        combineLatest([
          ownPlan$(this.stateProvider, userId),
          this.billing.hasPremiumFromAnyOrganization$(userId),
        ]),
      ),
      map(([plan, throughOrganization]) => ({ plan, throughOrganization })),
    ),
  );
}
