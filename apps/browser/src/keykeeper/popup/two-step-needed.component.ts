import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { firstValueFrom } from "rxjs";

import { KeykeeperMspRequests, TwoStepNeeded } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { ButtonModule, CalloutModule } from "@bitwarden/components";

import { BrowserApi } from "../../platform/browser/browser-api";

/**
 * Keykeeper: in the popup's vault, the organizations that can't confirm this
 * person until they turn on two-step login, with a way to the web vault's
 * two-step settings. Someone who joined through their company's install
 * command may never open the web vault otherwise. See DESIGN.md, "Joining".
 */
@Component({
  selector: "app-keykeeper-two-step-needed",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule],
  template: `
    @if (names(); as names) {
      <bit-callout
        type="warning"
        title="Turn on two-step login to finish joining"
        data-testid="two-step-needed"
      >
        <p class="tw-mb-2">{{ names }} requires two-step login before you can get in.</p>
        <button bitButton buttonType="primary" type="button" (click)="openTwoStepSettings()">
          Turn on two-step login
        </button>
      </bit-callout>
    }
  `,
})
export class KeykeeperTwoStepNeededComponent implements OnInit {
  private readonly requests = new KeykeeperMspRequests(inject(ApiService));
  private readonly environmentService = inject(EnvironmentService);
  private readonly waiting = signal<TwoStepNeeded[]>([]);

  protected readonly names = computed(() => {
    const names = this.waiting().map((o) => o.name);
    return names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  });

  async ngOnInit() {
    this.waiting.set(await this.requests.twoStepNeeded());
  }

  protected async openTwoStepSettings() {
    const environment = await firstValueFrom(this.environmentService.environment$);
    await BrowserApi.createNewTab(`${environment.getWebVaultUrl()}/#/settings/security/two-factor`);
  }
}
