import { AsyncPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";

import { DefaultServerSettingsService } from "@bitwarden/common/platform/services/default-server-settings.service";
import { LinkModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

/**
 * Keykeeper: under the extension's sign-in, how someone new gets an account
 * (DESIGN.md, "The look"): their admin invites them, or, on a server that
 * lets people sign up, they create one.
 */
@Component({
  selector: "app-keykeeper-login-secondary-content",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, I18nPipe, LinkModule, RouterLink],
  template: `
    <p class="tw-m-0 tw-text-center tw-text-sm tw-text-muted" data-testid="keykeeper-new-here">
      @if (registrationDisabled$ | async) {
        {{ "keykeeperNewHereInvite" | i18n }}
      } @else {
        {{ "keykeeperNewHere" | i18n }}
        <a bitLink routerLink="/signup" data-testid="login-create-account-link">{{
          "createAccount" | i18n
        }}</a>
      }
    </p>
  `,
})
export class KeykeeperLoginSecondaryContentComponent {
  protected readonly registrationDisabled$ = inject(DefaultServerSettingsService)
    .isUserRegistrationDisabled$;
}
