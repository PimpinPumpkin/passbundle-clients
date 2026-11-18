import { ClientType } from "@bitwarden/common/enums";

export type SsoClientType =
  ClientType.Web | ClientType.Browser | ClientType.Desktop | ClientType.Cli;

/**
 * Abstract class for SSO component services.
 */
export abstract class SsoComponentService {
  /**
   * Sets the cookies for the SSO component service.
   * Used to pass translation messages to the SSO connector page (apps/web/src/connectors/sso.ts) during the SSO handoff process.
   * See implementation in WebSsoComponentService for example usage.
   */
  setDocumentCookies?(): void;

  /**
   * Closes the window.
   */
  closeWindow?(): Promise<void>;

  /**
   * Keykeeper: starts single sign-on from this page's Continue in an app that
   * hands it off to the web vault (the browser extension). Such an app can't
   * send this page to the identity provider itself: the answer goes back to
   * the web vault, which only hands it to the app when the app started it
   * there. The extension shows this page after a refused sign-in, with the
   * identifier, to try again. See DESIGN.md, "Sign in with Microsoft Entra ID".
   */
  keykeeperHandOff?(email: string, identifier: string): Promise<void>;
}
