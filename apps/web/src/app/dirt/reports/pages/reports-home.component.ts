// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// FIXME(https://bitwarden.atlassian.net/browse/CL-1062): `OnPush` components should not use mutable properties
/* eslint-disable @bitwarden/components/enforce-readonly-angular-properties */
import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { confirmedMemberOfAny } from "@bitwarden/common/dirt/keykeeper/own-health";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";

import { reports, ReportType } from "../reports";
import { ReportEntry, ReportVariant } from "../shared";

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: "app-reports-home",
  templateUrl: "reports-home.component.html",
  standalone: false,
})
export class ReportsHomeComponent implements OnInit {
  readonly reports = signal<ReportEntry[]>([]);
  /** Keykeeper: whether their organizations' admins see their own passwords' numbers. */
  readonly keykeeperSeenByAdmins = signal(false);

  constructor(
    private billingAccountProfileStateService: BillingAccountProfileStateService,
    private accountService: AccountService,
    private configService: ConfigService,
    private organizationService: OrganizationService,
  ) {}

  async ngOnInit(): Promise<void> {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    this.keykeeperSeenByAdmins.set(
      await firstValueFrom(confirmedMemberOfAny(this.organizationService, account.id)),
    );
    const userHasPremium = await firstValueFrom(
      this.billingAccountProfileStateService.hasPremiumFromAnySource$(account.id),
    );
    const reportRequiresPremium = userHasPremium
      ? ReportVariant.Enabled
      : ReportVariant.RequiresPremium;

    const passkeyReportEnabled = await this.configService.getFeatureFlag(
      FeatureFlag.PasskeyLoginReport,
    );

    const reportEntries: ReportEntry[] = [
      {
        ...reports[ReportType.ExposedPasswords],
        variant: reportRequiresPremium,
      },
      {
        ...reports[ReportType.ReusedPasswords],
        variant: reportRequiresPremium,
      },
      {
        ...reports[ReportType.WeakPasswords],
        variant: reportRequiresPremium,
      },
      {
        ...reports[ReportType.UnsecuredWebsites],
        variant: reportRequiresPremium,
      },
      {
        ...reports[ReportType.Inactive2fa],
        variant: reportRequiresPremium,
      },
      {
        ...reports[ReportType.DataBreach],
        variant: ReportVariant.Enabled,
      },
      // Keykeeper: expiring items, for everyone.
      {
        ...reports[ReportType.KeykeeperExpiringItems],
        variant: ReportVariant.Enabled,
      },
    ];

    if (passkeyReportEnabled) {
      reportEntries.push({
        ...reports[ReportType.PasskeyLogin],
        variant: reportRequiresPremium,
      });
    }

    this.reports.set(reportEntries);
  }
}
