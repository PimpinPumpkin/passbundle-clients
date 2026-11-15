import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { RouterModule } from "@angular/router";
import { map } from "rxjs";

// Keykeeper: what a server that isn't taking new accounts says where the link would be.
import { KeykeeperNewAccountsClosedComponent } from "@bitwarden/angular/auth/keykeeper/new-accounts-closed.component";
import { JslibModule } from "@bitwarden/angular/jslib.module";
import { DefaultServerSettingsService } from "@bitwarden/common/platform/services/default-server-settings.service";
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { LinkModule } from "@bitwarden/components";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  imports: [
    CommonModule,
    JslibModule,
    LinkModule,
    RouterModule,
    KeykeeperNewAccountsClosedComponent,
  ],
  // Keykeeper: the link shows once the server has said it takes new accounts,
  // and a server that doesn't says so in its place (DESIGN.md, "New accounts
  // on a closed server"). Upstream showed the link until the settings came in,
  // and nothing on a closed server.
  template: `
    <div class="tw-text-center" *ngIf="(keykeeperNewAccounts$ | async) === 'open'">
      {{ "newToBitwarden" | i18n }}
      <a bitLink routerLink="/signup" data-testid="login-create-account-link">{{
        "createAccount" | i18n
      }}</a>
    </div>
    <div class="tw-text-center" *ngIf="(keykeeperNewAccounts$ | async) === 'closed'">
      <auth-keykeeper-new-accounts-closed reason="closed"></auth-keykeeper-new-accounts-closed>
    </div>
  `,
})
export class LoginSecondaryContentComponent {
  serverSettingsService = inject(DefaultServerSettingsService);

  protected isUserRegistrationDisabled$ = this.serverSettingsService.isUserRegistrationDisabled$;

  // Keykeeper: whether the server takes new accounts, once its settings have said.
  protected keykeeperNewAccounts$ = this.isUserRegistrationDisabled$.pipe(
    map((disabled) => (disabled ? ("closed" as const) : ("open" as const))),
  );
}
