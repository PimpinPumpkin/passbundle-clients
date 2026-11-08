// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// FIXME(https://bitwarden.atlassian.net/browse/CL-1062): `OnPush` components should not use mutable properties
/* eslint-disable @bitwarden/components/enforce-readonly-angular-properties */
import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { organizationNames, ownHealthSeenBy } from "@bitwarden/common/dirt/keykeeper/own-health";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";

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
  /**
   * Keykeeper: the organizations whose admins see how many of the person's
   * own passwords are weak, reused, or exposed, by name, as the server says
   * when the page opens: those they've joined that have "Members' own
   * passwords" on. Empty when none does, and the line isn't shown.
   */
  readonly keykeeperSeenBy = signal<string | null>(null);

  constructor(
    private billingAccountProfileStateService: BillingAccountProfileStateService,
    private accountService: AccountService,
    private configService: ConfigService,
    private apiService: ApiService,
    private logService: LogService,
  ) {}

  async ngOnInit(): Promise<void> {
    void this.keykeeperLoadSeenBy();
    const account = await firstValueFrom(this.accountService.activeAccount$);
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

  /** Keykeeper: who sees the numbers; nothing shown if the server can't say. */
  private async keykeeperLoadSeenBy() {
    try {
      const seenBy = await ownHealthSeenBy(this.apiService);
      this.keykeeperSeenBy.set(
        seenBy == null || seenBy.length === 0
          ? null
          : organizationNames(seenBy.map((organization) => organization.name)),
      );
    } catch (e) {
      this.logService.warning(`Couldn't read who sees your own passwords' numbers: ${String(e)}`);
    }
  }
}
