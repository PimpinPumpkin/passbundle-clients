import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";

import { TwoStepNeeded } from "@bitwarden/admin-console/common";
import { ButtonModule, CalloutModule } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: on the vault page, the organizations that can't confirm this
 * person until they turn on two-step login, with the way to do it. Nothing
 * shows otherwise. See DESIGN.md, "Joining".
 */
@Component({
  selector: "app-keykeeper-two-step-needed",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule, RouterLink],
  template: `
    @if (names(); as names) {
      <bit-callout
        type="warning"
        title="Turn on two-step login to finish joining"
        class="tw-mb-4 tw-block"
        data-testid="two-step-needed"
      >
        <p class="tw-mb-2">{{ names }} requires two-step login before you can get in.</p>
        <a bitButton buttonType="primary" routerLink="/settings/security/two-factor">
          Turn on two-step login
        </a>
      </bit-callout>
    }
  `,
})
export class KeykeeperTwoStepNeededComponent implements OnInit {
  private readonly api = inject(KeykeeperMspApiService);
  private readonly waiting = signal<TwoStepNeeded[]>([]);

  protected readonly names = computed(() => joinNames(this.waiting().map((o) => o.name)));

  async ngOnInit() {
    this.waiting.set(await this.api.twoStepNeeded());
  }
}

/** "A", "A and B", "A, B, and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
