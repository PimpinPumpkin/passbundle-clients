import { ChangeDetectionStrategy, Component } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { SessionTimeoutSettingsComponent } from "@bitwarden/key-management-ui";

import { KeykeeperReloadSettingComponent } from "../../keykeeper/reload-key/reload-setting.component";

@Component({
  templateUrl: "session-timeout.component.html",
  // Keykeeper: "Stay unlocked when I reload", under the timeout.
  imports: [SessionTimeoutSettingsComponent, JslibModule, KeykeeperReloadSettingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionTimeoutComponent {}
