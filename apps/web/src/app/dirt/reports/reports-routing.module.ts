import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";

import { authGuard } from "@bitwarden/angular/auth/guards";
import { KeykeeperPlanSentence } from "@bitwarden/angular/billing/keykeeper";
import { canAccessFeature } from "@bitwarden/angular/platform/guard/feature-flag.guard";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";

import { keykeeperPremiumReportGuard } from "./keykeeper-premium-report.guard";
import { BreachReportComponent } from "./pages/breach-report.component";
import { ExposedPasswordsReportComponent } from "./pages/exposed-passwords-report.component";
import { InactiveTwoFactorReportComponent } from "./pages/inactive-two-factor-report.component";
import { KeykeeperExpiringItemsReportComponent } from "./pages/keykeeper-expiring-items-report.component";
import { PasskeyReportComponent } from "./pages/passkey-report.component";
import { ReportsHomeComponent } from "./pages/reports-home.component";
import { ReusedPasswordsReportComponent } from "./pages/reused-passwords-report.component";
import { UnsecuredWebsitesReportComponent } from "./pages/unsecured-websites-report.component";
import { WeakPasswordsReportComponent } from "./pages/weak-passwords-report.component";
import { ReportsLayoutComponent } from "./reports-layout.component";

// Keykeeper: the weak, reused and exposed password reports are free and the
// data breach report is part of Premium (DESIGN.md, "Plans and billing").
// Upstream had it the other way round. A report that needs Premium says so in
// one sentence and leaves the person on the list of reports.
const routes: Routes = [
  {
    path: "",
    component: ReportsLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: "",
        pathMatch: "full",
        component: ReportsHomeComponent,
        data: { titleId: "reports", homepage: true },
      },
      {
        // Keykeeper
        path: "expiring-items-report",
        component: KeykeeperExpiringItemsReportComponent,
        data: { titleId: "keykeeperExpiringItemsReport" },
      },
      {
        path: "breach-report",
        component: BreachReportComponent,
        data: { titleId: "dataBreachReport" },
        canActivate: [keykeeperPremiumReportGuard(KeykeeperPlanSentence.BreachReport)],
      },
      {
        path: "reused-passwords-report",
        component: ReusedPasswordsReportComponent,
        data: { titleId: "reusedPasswordsReport" },
      },
      {
        path: "unsecured-websites-report",
        component: UnsecuredWebsitesReportComponent,
        data: { titleId: "unsecuredWebsitesReport" },
        canActivate: [keykeeperPremiumReportGuard()],
      },
      {
        path: "weak-passwords-report",
        component: WeakPasswordsReportComponent,
        data: { titleId: "weakPasswordsReport" },
      },
      {
        path: "exposed-passwords-report",
        component: ExposedPasswordsReportComponent,
        data: { titleId: "exposedPasswordsReport" },
      },
      {
        path: "inactive-two-factor-report",
        component: InactiveTwoFactorReportComponent,
        data: { titleId: "inactive2faReport" },
        canActivate: [keykeeperPremiumReportGuard()],
      },
      {
        path: "passkey-report",
        component: PasskeyReportComponent,
        data: { titleId: "passkeyLoginReport" },
        canActivate: [
          keykeeperPremiumReportGuard(),
          canAccessFeature(FeatureFlag.PasskeyLoginReport, true, "/reports", false),
        ],
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ReportsRoutingModule {}
