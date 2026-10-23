// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, computed, inject, OnInit, Signal } from "@angular/core";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterModule } from "@angular/router";
import {
  catchError,
  distinctUntilChanged,
  filter,
  from,
  map,
  Observable,
  of,
  switchMap,
} from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { PasswordManagerLogo } from "@bitwarden/assets/svg";
import { canAccessEmergencyAccess } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { PopoverModule, SideNavService, SvgModule } from "@bitwarden/components";
import { SendPolicyService } from "@bitwarden/send-ui";
import { PremiumSubscriptionRoutingService } from "@bitwarden/web-vault/app/billing/individual/services/premium-subscription-routing.service";

import { BillingFreeFamiliesNavItemComponent } from "../billing/shared/billing-free-families-nav-item.component";
import { KeykeeperMspApiService } from "../keykeeper/msp/msp-api.service";
import { KEYKEEPER_MENU_BUTTON } from "../keykeeper/vault-menu/menu-button";
import { KeykeeperVaultMenuComponent } from "../keykeeper/vault-menu/vault-menu.component";
import { CoachmarkComponent, CoachmarkService } from "../vault/components/coachmark";

import { WebLayoutModule } from "./web-layout.module";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-user-layout",
  templateUrl: "user-layout.component.html",
  imports: [
    CommonModule,
    RouterModule,
    JslibModule,
    WebLayoutModule,
    SvgModule,
    BillingFreeFamiliesNavItemComponent,
    PopoverModule,
    CoachmarkComponent,
    KeykeeperVaultMenuComponent,
  ],
  // Keykeeper: pages here show a button that opens the menu where it's hidden (a phone).
  providers: [{ provide: KEYKEEPER_MENU_BUTTON, useValue: true }],
})
export class UserLayoutComponent implements OnInit {
  protected readonly logo = PasswordManagerLogo;
  protected readonly showEmergencyAccess: Signal<boolean>;
  protected readonly sendEnabled$: Observable<boolean> = this.sendPolicyService.disableSend$.pipe(
    map((disableSend) => !disableSend),
  );
  protected subscriptionRoute$: Observable<string | null>;

  protected readonly coachmarkService = inject(CoachmarkService);
  protected readonly sideNavService = inject(SideNavService);

  protected readonly importCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "importData",
  );

  /** Keykeeper: the MSP console shows in the nav for MSP staff. */
  protected readonly showMspConsole = toSignal(
    from(inject(KeykeeperMspApiService).list()).pipe(
      map((msps) => msps.length > 0),
      catchError(() => of(false)),
    ),
    { initialValue: false },
  );

  /** Expand the import and export nav group when import coachmark is active */
  protected readonly toolsNavGroupOpen = computed(
    () => this.coachmarkService.activeStepId() === "importData",
  );

  constructor(
    private syncService: SyncService,
    private accountService: AccountService,
    private policyService: PolicyService,
    private sendPolicyService: SendPolicyService,
    private premiumSubscriptionRoutingService: PremiumSubscriptionRoutingService,
  ) {
    this.showEmergencyAccess = toSignal(
      this.accountService.activeAccount$.pipe(
        getUserId,
        switchMap((userId) => canAccessEmergencyAccess(userId, this.policyService)),
      ),
    );

    this.subscriptionRoute$ = this.premiumSubscriptionRoutingService.getSubscriptionRoute$();

    // Keykeeper: where the menu covers the page (a phone), going to another
    // page closes it. Picking a filter closes it too (the menu does that);
    // typing a search doesn't.
    const router = inject(Router);
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        map(() => router.url.split(/[?#]/)[0]),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (this.sideNavService.isOverlay()) {
          this.sideNavService.open.set(false);
        }
      });
  }

  async ngOnInit() {
    document.body.classList.remove("layout_frontend");
    await this.syncService.fullSync(false);
  }
}
