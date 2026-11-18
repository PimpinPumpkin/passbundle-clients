import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import {
  KeykeeperTwoStepNudge,
  TWO_STEP_NUDGE,
  TwoStepNudgeKind,
} from "@bitwarden/admin-console/common";
import { BannerModule, LinkModule } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: on the vault page, a nudge about two-step login for someone no
 * rule requires it of: to set it up, for someone with none at all, or to
 * add a stronger method, for someone whose only second step is email codes.
 * A one-line banner, as upstream's own vault banners are, so it doesn't push
 * the list far down. "Not now" hides either for 90 days on every device. It
 * never blocks anything: nothing shows when the server can't be asked. See
 * DESIGN.md, "A nudge for everyone else".
 */
@Component({
  selector: "app-keykeeper-two-step-nudge",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BannerModule, LinkModule, RouterLink],
  template: `
    @if (nudge(); as kind) {
      <bit-banner
        variant="primary"
        icon="bwi-lock"
        [useAlertRole]="false"
        data-testid="two-step-nudge"
        [attr.data-nudge]="kind"
      >
        {{ words.words[kind].text }}
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
  private readonly twoStepNudge = new KeykeeperTwoStepNudge(inject(KeykeeperMspApiService));
  protected readonly nudge = signal<TwoStepNudgeKind | null>(null);
  protected readonly words = TWO_STEP_NUDGE;

  async ngOnInit() {
    this.nudge.set(await this.twoStepNudge.load());
  }

  protected async notNow() {
    this.nudge.set(null);
    await this.twoStepNudge.notNow();
  }
}
