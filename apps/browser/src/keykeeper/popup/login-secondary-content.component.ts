import { AsyncPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { map } from "rxjs";

import { KeykeeperNewAccountsClosedComponent } from "@bitwarden/angular/auth/keykeeper/new-accounts-closed.component";
import { DefaultServerSettingsService } from "@bitwarden/common/platform/services/default-server-settings.service";
import { LinkModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

/**
 * Keykeeper: under the extension's sign-in, how someone new gets an account
 * (DESIGN.md, "The look" and "New accounts on a closed server"): on a server
 * that lets people sign up, they create one; on one that doesn't, it says so
 * and who to ask. Nothing shows until the server's settings are in, so the
 * link is never offered on a server that would turn it down.
 */
@Component({
  selector: "app-keykeeper-login-secondary-content",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, I18nPipe, LinkModule, RouterLink, KeykeeperNewAccountsClosedComponent],
  template: `
    @switch (newAccounts$ | async) {
      @case ("open") {
        <p class="tw-m-0 tw-text-center tw-text-sm tw-text-muted" data-testid="keykeeper-new-here">
          {{ "keykeeperNewHere" | i18n }}
          <a bitLink routerLink="/signup" data-testid="login-create-account-link">{{
            "createAccount" | i18n
          }}</a>
        </p>
      }
      @case ("closed") {
        <p class="tw-m-0 tw-text-center tw-text-sm tw-text-muted">
          <auth-keykeeper-new-accounts-closed reason="closed"></auth-keykeeper-new-accounts-closed>
        </p>
      }
    }
  `,
})
export class KeykeeperLoginSecondaryContentComponent {
  protected readonly newAccounts$ = inject(
    DefaultServerSettingsService,
  ).isUserRegistrationDisabled$.pipe(
    map((disabled) => (disabled ? ("closed" as const) : ("open" as const))),
  );
}
