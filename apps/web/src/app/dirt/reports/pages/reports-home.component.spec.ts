import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { KeykeeperPlanSentence } from "@bitwarden/angular/billing/keykeeper";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";

import { ReportVariant } from "../shared";

import { ReportsHomeComponent } from "./reports-home.component";

// Keykeeper: the weak, reused and exposed password reports are free and the
// data breach report is part of Premium (DESIGN.md, "Plans and billing").
describe("ReportsHomeComponent", () => {
  async function reportsFor(hasPremium: boolean) {
    const configService = mock<ConfigService>();
    configService.getFeatureFlag.mockResolvedValue(false);
    const apiService = mock<ApiService>();
    apiService.send.mockResolvedValue({ organizations: [] });

    TestBed.configureTestingModule({});
    const component = TestBed.runInInjectionContext(
      () =>
        new ReportsHomeComponent(
          {
            hasPremiumFromAnySource$: () => of(hasPremium),
          } as unknown as BillingAccountProfileStateService,
          { activeAccount$: of({ id: "user-1" }) } as unknown as AccountService,
          configService,
          apiService,
          mock<LogService>(),
        ),
    );
    await component.ngOnInit();
    return Object.fromEntries(component.reports().map((r) => [r.route, r]));
  }

  it("leaves the password reports open on Free", async () => {
    const reports = await reportsFor(false);

    expect(reports["weak-passwords-report"].variant).toBe(ReportVariant.Enabled);
    expect(reports["reused-passwords-report"].variant).toBe(ReportVariant.Enabled);
    expect(reports["exposed-passwords-report"].variant).toBe(ReportVariant.Enabled);
  });

  it("marks the data breach report as Premium on Free, with its own sentence", async () => {
    const reports = await reportsFor(false);

    expect(reports["breach-report"].variant).toBe(ReportVariant.RequiresPremium);
    expect(reports["breach-report"].keykeeperSentence).toBe(KeykeeperPlanSentence.BreachReport);
  });

  it("opens every report with Premium", async () => {
    const reports = await reportsFor(true);

    expect(reports["breach-report"].variant).toBe(ReportVariant.Enabled);
    expect(reports["weak-passwords-report"].variant).toBe(ReportVariant.Enabled);
  });
});
