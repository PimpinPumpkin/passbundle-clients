import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { KeykeeperTwoStepNudge, TWO_STEP_NUDGE } from "@bitwarden/admin-console/common";
import { ButtonModule, CalloutModule } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: on the vault page, a nudge to set up two-step login for someone
 * who has none at all and whom no rule requires it of. "Not now" hides it for
 * 90 days on every device. It never blocks anything: nothing shows when the
 * server can't be asked. See DESIGN.md, "A nudge for everyone else".
 */
@Component({
  selector: "app-keykeeper-two-step-nudge",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule, RouterLink],
  template: `
    @if (show()) {
      <bit-callout
        type="info"
        [title]="words.title"
        class="tw-mb-4 tw-block"
        data-testid="two-step-nudge"
      >
        <p class="tw-mb-2">{{ words.text }}</p>
        <div class="tw-flex tw-flex-wrap tw-gap-2">
          <a bitButton buttonType="primary" routerLink="/settings/security/two-factor">
            {{ words.setUp }}
          </a>
          <button bitButton buttonType="secondary" type="button" (click)="notNow()">
            {{ words.notNow }}
          </button>
        </div>
      </bit-callout>
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
