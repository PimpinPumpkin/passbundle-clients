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

import { PasswordManagerLogo } from "@bitwarden/assets/svg";
import {
  canAccessEmergencyAccess,
  singleOrganizationPolicyApplies$,
} from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { PopoverModule, SideNavService, SvgModule } from "@bitwarden/components";
import { SendPolicyService } from "@bitwarden/send-ui";
import { I18nPipe } from "@bitwarden/ui-common";
import { CoachmarkComponent, CoachmarkService } from "@bitwarden/vault";

import { BillingFreeFamiliesNavItemComponent } from "../billing/shared/billing-free-families-nav-item.component";
import { KeykeeperMspApiService } from "../keykeeper/msp/msp-api.service";
import { KEYKEEPER_MENU_BUTTON } from "../keykeeper/vault-menu/menu-button";
import { KeykeeperVaultMenuComponent } from "../keykeeper/vault-menu/vault-menu.component";

import { WebLayoutModule } from "./web-layout.module";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-user-layout",
  templateUrl: "user-layout.component.html",
  imports: [
    CommonModule,
    RouterModule,
    I18nPipe,
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

  protected readonly coachmarkService = inject(CoachmarkService);
  protected readonly sideNavService = inject(SideNavService);
  private readonly configService = inject(ConfigService);

  protected readonly exportRoute = computed(() => {
    const vfo1Enabled = this.vfo1Enabled();
    return vfo1Enabled ? "/settings/export" : "/tools/export";
  });

  protected readonly vfo1Enabled: Signal<boolean> = toSignal(
    inject(ConfigService).getFeatureFlag$(FeatureFlag.VFO1Foundation),
    { initialValue: false },
  );

  protected readonly singleOrgPolicyApplies = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => singleOrganizationPolicyApplies$(userId, this.policyService)),
    ),
    { initialValue: true },
  );

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
  ) {
    this.showEmergencyAccess = toSignal(
      this.accountService.activeAccount$.pipe(
        getUserId,
        switchMap((userId) => canAccessEmergencyAccess(userId, this.policyService)),
      ),
    );

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
