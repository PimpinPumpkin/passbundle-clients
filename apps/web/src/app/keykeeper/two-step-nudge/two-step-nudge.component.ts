import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { KeykeeperTwoStepNudge, TWO_STEP_NUDGE } from "@bitwarden/admin-console/common";
import { BannerModule, LinkModule } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: on the vault page, a nudge to set up two-step login for someone
 * who has none at all and whom no rule requires it of. A one-line banner, as
 * upstream's own vault banners are, so it doesn't push the list far down.
 * "Not now" hides it for 90 days on every device. It never blocks anything:
 * nothing shows when the server can't be asked. See DESIGN.md, "A nudge for
 * everyone else".
 */
@Component({
  selector: "app-keykeeper-two-step-nudge",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BannerModule, LinkModule, RouterLink],
  template: `
    @if (show()) {
      <bit-banner
        variant="primary"
        icon="bwi-lock"
        [useAlertRole]="false"
        data-testid="two-step-nudge"
      >
        {{ words.text }}
        <a bitLink linkType="secondary" routerLink="/settings/security/two-factor">{{
          words.setUp
        }}</a>
        ·
        <button type="button" bitLink linkType="secondary" (click)="notNow()">
          {{ words.notNow }}
        </button>
      </bit-banner>
    }
  `,
})
export class KeykeeperTwoStepNudgeComponent implements OnInit {
  private readonly nudge = new KeykeeperTwoStepNudge(inject(KeykeeperMspApiService));
  protected readonly show = signal(false);
  protected readonly words = TWO_STEP_NUDGE;

  async ngOnInit() {
    this.show.set(await this.nudge.load());
  }

  protected async notNow() {
    this.show.set(false);
    await this.nudge.notNow();
  }
}
