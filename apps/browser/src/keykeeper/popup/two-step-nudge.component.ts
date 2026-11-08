import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  KeykeeperMspRequests,
  KeykeeperTwoStepNudge,
  TWO_STEP_NUDGE,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { ButtonModule, CalloutModule } from "@bitwarden/components";

import { BrowserApi } from "../../platform/browser/browser-api";

/**
 * Keykeeper: in the popup's vault, a nudge to set up two-step login for
 * someone who has none at all and whom no rule requires it of, with a way to
 * the web vault's two-step settings. "Not now" hides it for 90 days on every
 * device, the web vault included. It never blocks anything: nothing shows
 * when the server can't be asked. See DESIGN.md, "A nudge for everyone else".
 */
@Component({
  selector: "app-keykeeper-two-step-nudge",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule],
  template: `
    @if (show()) {
      <bit-callout
        type="info"
        [title]="words.title"
        class="tw-mb-3 tw-block"
        data-testid="two-step-nudge"
      >
        <p class="tw-mb-2">{{ words.text }}</p>
        <div class="tw-flex tw-flex-wrap tw-gap-2">
          <button bitButton buttonType="primary" type="button" (click)="setUp()">
            {{ words.setUp }}
          </button>
          <button bitButton buttonType="secondary" type="button" (click)="notNow()">
            {{ words.notNow }}
          </button>
        </div>
      </bit-callout>
    }
  `,
})
export class KeykeeperTwoStepNudgeComponent implements OnInit {
  private readonly nudge = new KeykeeperTwoStepNudge(new KeykeeperMspRequests(inject(ApiService)));
  private readonly environmentService = inject(EnvironmentService);
  protected readonly show = signal(false);
  protected readonly words = TWO_STEP_NUDGE;

  async ngOnInit() {
    this.show.set(await this.nudge.load());
  }

  protected async setUp() {
    const environment = await firstValueFrom(this.environmentService.environment$);
    await BrowserApi.createNewTab(`${environment.getWebVaultUrl()}/#/settings/security/two-factor`);
  }

  protected async notNow() {
    this.show.set(false);
    await this.nudge.notNow();
  }
}
