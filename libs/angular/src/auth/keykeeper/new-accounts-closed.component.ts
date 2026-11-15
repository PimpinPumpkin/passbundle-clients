import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";

import {
  EnvironmentService,
  Region,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LinkModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

/** Why there's no new account: the server takes none, or not for the address just tried. */
export type KeykeeperNewAccountsReason = "closed" | "address";

/**
 * Keykeeper: what the web vault and the extension say where "Create account"
 * would be, on a server that isn't taking new accounts (DESIGN.md, "New
 * accounts on a closed server"): one plain sentence and who to ask. On the
 * service that's a link to the website's Contact page; on anyone else's
 * server it's the person who runs it, since only they can open it or send an
 * invitation.
 *
 * `reason` is "closed" for a server that takes no new accounts, and "address"
 * when the server turned down the address just tried (it allows some email
 * domains, and never says which).
 */
@Component({
  selector: "auth-keykeeper-new-accounts-closed",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe, LinkModule],
  template: `
    @if (where(); as where) {
      <span data-testid="keykeeper-new-accounts-closed" [attr.data-reason]="reason()">
        @if (where === "service") {
          {{
            (reason() === "address"
              ? "keykeeperNewAccountsNotThatAddress"
              : "keykeeperNewAccountsNotOpenYet"
            ) | i18n
          }}
          @if (contactPage) {
            <a
              bitLink
              [href]="contactPage"
              target="_blank"
              rel="noreferrer"
              data-testid="keykeeper-ask-for-account"
              >{{ "keykeeperNewAccountsAskForOne" | i18n }}</a
            >
          }
        } @else {
          {{
            (reason() === "address"
              ? "keykeeperNewAccountsNotThatAddressOwnServer"
              : "keykeeperNewAccountsOwnServer"
            ) | i18n
          }}
        }
      </span>
    }
  `,
})
export class KeykeeperNewAccountsClosedComponent {
  readonly reason = input<KeykeeperNewAccountsReason>("closed");

  /**
   * The service's own vault, or a server someone else runs. Before sign-in
   * that's the environment the sign-in and sign-up pages talk to.
   */
  protected readonly where = toSignal(
    inject(EnvironmentService).globalEnvironment$.pipe(
      map((environment) =>
        environment.getRegion() === Region.SelfHosted ? ("own" as const) : ("service" as const),
      ),
    ),
  );

  /**
   * The website's Contact page. The brand step writes its address from
   * brand.json, so it's never typed here; a build without it shows no link.
   */
  protected readonly contactPage = contactPageAddress(
    inject(I18nService).t("keykeeperContactPage"),
  );
}

/** An https address, or nothing: a missing message comes back empty or as its own key. */
function contactPageAddress(message: string): string | null {
  return typeof message === "string" && message.startsWith("https://") ? message : null;
}
