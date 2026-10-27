import { Router } from "@angular/router";

import { AuthResult } from "@bitwarden/common/auth/models/domain/auth-result";
import { ClientType } from "@bitwarden/common/enums";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { ToastService } from "@bitwarden/components";

/**
 * Keykeeper: where the web vault keeps a linking session while the person
 * links their Microsoft account (to Microsoft and back), for this tab only.
 */
export const KEYKEEPER_SSO_LINK_SESSION = "keykeeper.ssoLinkSession";

export type KeykeeperSsoLinkSession = { token: string; identifier: string };

/**
 * Keykeeper: an organization requires single sign-on of someone who isn't
 * linked to it yet, so their password and two-step login got a linking
 * session instead of a login. The web vault takes them through linking
 * (its /sso-link page); other apps send them there. True when it handled the
 * result. See DESIGN.md, "Sign in with Microsoft Entra ID".
 */
export async function keykeeperStartSsoLink(
  authResult: AuthResult,
  deps: {
    router: Router;
    toastService: ToastService;
    i18nService: I18nService;
    clientType: ClientType;
  },
): Promise<boolean> {
  const token = authResult.keykeeperSsoLinkSession;
  const identifier = authResult.ssoOrganizationIdentifier;
  if (!token || !identifier) {
    return false;
  }
  if (deps.clientType !== ClientType.Web) {
    deps.toastService.showToast({
      variant: "error",
      title: "",
      message: deps.i18nService.t("keykeeperSsoLinkInWebVault"),
    });
    return true;
  }
  const session: KeykeeperSsoLinkSession = { token, identifier };
  sessionStorage.setItem(KEYKEEPER_SSO_LINK_SESSION, JSON.stringify(session));
  await deps.router.navigate(["/sso-link"], { queryParams: { identifier } });
  return true;
}
