import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";

import { PremiumBadgeComponent } from "@bitwarden/angular/billing/components/premium-badge";
import { BaseCardComponent, CardContentComponent } from "@bitwarden/components";
import { KeykeeperCategoryTileComponent } from "@bitwarden/vault";

import { SharedModule } from "../../../shared/shared.module";

import { ReportCardComponent } from "./report-card/report-card.component";
import { ReportListComponent } from "./report-list/report-list.component";

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    BaseCardComponent,
    CardContentComponent,
    PremiumBadgeComponent,
    KeykeeperCategoryTileComponent,
  ],
  declarations: [ReportCardComponent, ReportListComponent],
  exports: [ReportCardComponent, ReportListComponent],
})
export class ReportsSharedModule {}
