import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  KeykeeperMspRequests,
  KeykeeperTwoStepNudge,
  TWO_STEP_NUDGE,
  TwoStepNudgeKind,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { ButtonModule, CalloutModule } from "@bitwarden/components";

import { BrowserApi } from "../../platform/browser/browser-api";

/**
 * Keykeeper: in the popup's vault, a nudge about two-step login for someone
 * no rule requires it of: to set it up, for someone with none at all, or to
 * add a stronger method, for someone whose only second step is email codes;
 * with a way to the web vault's two-step settings. "Not now" hides either
 * for 90 days on every device, the web vault included. It never blocks
 * anything: nothing shows when the server can't be asked. See DESIGN.md, "A
 * nudge for everyone else".
 */
@Component({
  selector: "app-keykeeper-two-step-nudge",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule],
  template: `
    @if (nudge(); as kind) {
      <bit-callout
        type="info"
        [title]="words.words[kind].title"
        class="tw-mb-3 tw-block"
        data-testid="two-step-nudge"
        [attr.data-nudge]="kind"
      >
        <p class="tw-mb-2">{{ words.words[kind].text }}</p>
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
  private readonly twoStepNudge = new KeykeeperTwoStepNudge(
    new KeykeeperMspRequests(inject(ApiService)),
  );
  private readonly environmentService = inject(EnvironmentService);
  protected readonly nudge = signal<TwoStepNudgeKind | null>(null);
  protected readonly words = TWO_STEP_NUDGE;

  async ngOnInit() {
    this.nudge.set(await this.twoStepNudge.load());
  }

  protected async setUp() {
    const environment = await firstValueFrom(this.environmentService.environment$);
    await BrowserApi.createNewTab(`${environment.getWebVaultUrl()}/#/settings/security/two-factor`);
  }

  protected async notNow() {
    this.nudge.set(null);
    await this.twoStepNudge.notNow();
  }
}
