import { NgModule } from "@angular/core";

import { TwoFactorIconComponent } from "@bitwarden/angular/auth/components/two-factor-icon.component";
import { PremiumBadgeComponent } from "@bitwarden/angular/billing/components/premium-badge";
import { ItemModule } from "@bitwarden/components";
import { Vfo1I18nPipe } from "@bitwarden/vault";

import { DangerZoneComponent } from "../../../auth/settings/account/danger-zone.component";
import { AccountFingerprintComponent } from "../../../key-management/account-fingerprint/account-fingerprint.component";
import { KeykeeperOrgJoiningComponent } from "../../../keykeeper/joining/org-joining.component";
import { KeykeeperOrgInstallComponent } from "../../../keykeeper/organizations/org-install.component";
import { KeykeeperScriptAccessComponent } from "../../../keykeeper/organizations/script-access.component";
import { HeaderModule } from "../../../layouts/header/header.module";
import { SharedModule } from "../../../shared";

import { AccountComponent } from "./account.component";
import { OrganizationSettingsRoutingModule } from "./organization-settings-routing.module";
import { TwoFactorSetupComponent } from "./two-factor-setup.component";

@NgModule({
  imports: [
    SharedModule,
    // Keykeeper: how people join the organization, and its install command.
    KeykeeperOrgJoiningComponent,
    KeykeeperOrgInstallComponent,
    KeykeeperScriptAccessComponent,
    OrganizationSettingsRoutingModule,
    AccountFingerprintComponent,
    DangerZoneComponent,
    HeaderModule,
    PremiumBadgeComponent,
    ItemModule,
    TwoFactorIconComponent,
    Vfo1I18nPipe,
  ],
  declarations: [AccountComponent, TwoFactorSetupComponent],
})
export class OrganizationSettingsModule {}
