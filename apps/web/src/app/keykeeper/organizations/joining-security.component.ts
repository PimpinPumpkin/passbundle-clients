import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { map } from "rxjs";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";
import { KeykeeperOrgJoiningComponent } from "../joining/org-joining.component";

import { KeykeeperAdminTwoStepComponent } from "./admin-two-step.component";
import { KeykeeperBrowserAutofillSettingComponent } from "./browser-autofill-setting.component";
import { KeykeeperOrgInstallComponent } from "./org-install.component";
import { KeykeeperPasswordChangeSettingComponent } from "./password-change-setting.component";
import { KeykeeperScriptAccessComponent } from "./script-access.component";

/**
 * Keykeeper: an organization's "Joining and security" page, under Settings,
 * for its owners and admins: two-step login for admins, how people join, the
 * install command, script access, assisted password change, and the browsers'
 * card and address autofill. Organization info, where these were,
 * is upstream's owners-only page, and it loads an owners-only endpoint, so a
 * company's own IT admin couldn't reach them there. Each card asks the server
 * for its own part and stays hidden when the server says "not found", so
 * this page shows a person exactly what the server lets them have: for an
 * MSP's technician who is an admin in a client, Joining and which IT provider
 * manages the install command, not the rest. See DESIGN.md, "A company's own
 * IT".
 */
@Component({
  selector: "app-keykeeper-joining-security",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedModule,
    HeaderModule,
    KeykeeperAdminTwoStepComponent,
    KeykeeperBrowserAutofillSettingComponent,
    KeykeeperOrgJoiningComponent,
    KeykeeperOrgInstallComponent,
    KeykeeperPasswordChangeSettingComponent,
    KeykeeperScriptAccessComponent,
  ],
  template: `
    <app-header title="Joining and security"></app-header>
    <bit-container>
      @if (organizationId(); as id) {
        <!-- Each card starts with a wide gap above its heading; the first one sits at the top. -->
        <div class="-tw-mt-16" data-testid="joining-security">
          <app-keykeeper-admin-two-step [organizationId]="id" />
          <app-keykeeper-org-joining [organizationId]="id" />
          <app-keykeeper-org-install [organizationId]="id" />
          <app-keykeeper-script-access [organizationId]="id" />
          <app-keykeeper-password-change-setting [organizationId]="id" />
          <app-keykeeper-browser-autofill-setting [organizationId]="id" />
        </div>
      }
    </bit-container>
  `,
})
export class KeykeeperJoiningSecurityComponent {
  protected readonly organizationId = toSignal(
    inject(ActivatedRoute).params.pipe(map((params) => params.organizationId as string)),
  );
}
