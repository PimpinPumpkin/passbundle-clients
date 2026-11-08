import { Component, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom, takeUntil, tap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { getById } from "@bitwarden/common/platform/misc";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogService } from "@bitwarden/components";
import { LogService } from "@bitwarden/logging";
import {
  CipherFormConfigService,
  KeykeeperExpirationBadgeComponent,
  KeykeeperItemTileComponent,
  PasswordRepromptService,
  RoutedVaultFilterBridgeService,
  RoutedVaultFilterService,
} from "@bitwarden/vault";

import { HeaderModule } from "../../../../layouts/header/header.module";
import { SharedModule } from "../../../../shared";
import { AdminConsoleCipherFormConfigService } from "../../../../vault/org-vault/services/admin-console-cipher-form-config.service";
import { KeykeeperExpiringItemsReportComponent as BaseExpiringItemsReportComponent } from "../keykeeper-expiring-items-report.component";

/**
 * Keykeeper: an organization's items that have expired or expire in the next
 * 30 days, soonest first, in its admin console's Reports, as a person's
 * Reports lists theirs (DESIGN.md, "Expiration dates"). The items are the
 * admin console's own, as the organization's other reports load them.
 */
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-org-keykeeper-expiring-items-report",
  templateUrl: "../keykeeper-expiring-items-report.component.html",
  providers: [
    {
      provide: CipherFormConfigService,
      useClass: AdminConsoleCipherFormConfigService,
    },
    AdminConsoleCipherFormConfigService,
    RoutedVaultFilterService,
    RoutedVaultFilterBridgeService,
  ],
  imports: [
    HeaderModule,
    KeykeeperExpirationBadgeComponent,
    KeykeeperItemTileComponent,
    SharedModule,
  ],
})
export class KeykeeperOrgExpiringItemsReportComponent
  extends BaseExpiringItemsReportComponent
  implements OnInit
{
  constructor(
    cipherService: CipherService,
    organizationService: OrganizationService,
    dialogService: DialogService,
    accountService: AccountService,
    passwordRepromptService: PasswordRepromptService,
    i18nService: I18nService,
    syncService: SyncService,
    cipherFormConfigService: CipherFormConfigService,
    adminConsoleCipherFormConfigService: AdminConsoleCipherFormConfigService,
    logService: LogService,
    private readonly route: ActivatedRoute,
  ) {
    super(
      cipherService,
      organizationService,
      dialogService,
      accountService,
      passwordRepromptService,
      i18nService,
      syncService,
      cipherFormConfigService,
      adminConsoleCipherFormConfigService,
      logService,
    );
  }

  async ngOnInit() {
    this.isAdminConsoleActive = true;
    this.route.parent?.parent?.params
      .pipe(
        tap(async (params) => {
          try {
            const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
            this.organization = await firstValueFrom(
              this.organizationService.organizations$(userId).pipe(getById(params.organizationId)),
            );
            await super.ngOnInit();
          } catch (e) {
            this.logService.error(
              `[KeykeeperExpiringItemsReport] Failed to load for organization "${params.organizationId}"`,
              e,
            );
          }
        }),
        takeUntil(this.destroyed$),
      )
      .subscribe();
  }

  /** The organization's items, as the admin console lists them. */
  protected async getAllCiphers(): Promise<CipherView[]> {
    return this.organization
      ? await this.cipherService.getAllFromApiForOrganization(this.organization.id, true)
      : [];
  }
}
