import { Injectable } from "@angular/core";

import {
  DefaultSsoComponentService,
  LoginComponentService,
  SsoComponentService,
} from "@bitwarden/auth/angular";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";

/**
 * This service is used to handle the SSO login process for the browser extension.
 */
@Injectable()
export class ExtensionSsoComponentService
  extends DefaultSsoComponentService
  implements SsoComponentService
{
  constructor(
    protected syncService: SyncService,
    protected authService: AuthService,
    protected environmentService: EnvironmentService,
    protected i18nService: I18nService,
    protected logService: LogService,
    // Keykeeper: to start single sign-on again the way the sign-in page does.
    private loginComponentService: LoginComponentService,
  ) {
    super();
  }

  /**
   * Closes the popup window after a successful login.
   */
  async closeWindow() {
    window.close();
  }

  /**
   * Keykeeper: the window that finishes a single sign-on shows the identifier
   * again after a refused sign-in. Its Continue hands off to the web vault in
   * a new tab, with new state and PKCE challenge of the extension's own, as
   * the sign-in page's "Use single sign-on" does, so the answer comes back to
   * the extension. Sent to Microsoft from this window, it would end on the web
   * vault's sign-in page, which only hands back what the extension started
   * there. See DESIGN.md, "Sign in with Microsoft Entra ID".
   */
  async keykeeperHandOff(email: string, identifier: string) {
    await this.loginComponentService.redirectToSsoLoginWithOrganizationSsoIdentifier(
      email,
      identifier,
    );
  }
}
