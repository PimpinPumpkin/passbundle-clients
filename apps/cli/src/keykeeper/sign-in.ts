// Keykeeper: signing in from the command-line tool where an organization
// requires single sign-on (DESIGN.md, "Sign in with Microsoft Entra ID",
// "Require single sign-on", in the meta repo). The server answers a password
// sign-in with the organization's SSO identifier; upstream's tool then opens
// the browser for it. Two cases it can't finish here are said plainly.

import { CLI_BRAND } from "./brand";

type SsoRequired = {
  ssoOrganizationIdentifier?: string | null;
  keykeeperSsoLinkSession?: string | null;
};

/**
 * Why a sign-in that the server sent to single sign-on can't go on here, or
 * null when the tool can open the browser for it: the account isn't linked to
 * the organization's single sign-on yet (the server sent a linking session,
 * which only the web vault uses), or the tool may not prompt or open anything.
 */
export function ssoRequiredRefusal(response: SsoRequired, canInteract: boolean): string | null {
  const identifier = response.ssoOrganizationIdentifier?.trim();
  const sso = `\`${CLI_BRAND.command} login --sso${identifier ? " " + identifier : ""}\``;
  if (response.keykeeperSsoLinkSession) {
    return (
      "Your organization requires you to sign in with single sign-on, and your account isn't " +
      "linked to it yet. Sign in to the web vault with your master password once to link it, " +
      `then run ${sso}.`
    );
  }
  if (!canInteract) {
    return (
      "Your organization requires you to sign in with single sign-on, which opens a browser. " +
      `Run ${sso} where one can open, ` +
      `or sign in with an API key (\`${CLI_BRAND.command} login --apikey\`).`
    );
  }
  return null;
}

/** What the tool says as it opens the browser for single sign-on. */
export function ssoPromptMessage(url: string): string {
  return `Opening your browser to sign in. If it doesn't open, go to:\n${url}`;
}
