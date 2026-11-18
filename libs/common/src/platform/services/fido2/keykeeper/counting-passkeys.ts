// Keykeeper: a passkey that counts its sign-ins, in one of the person's own logins where an
// organization keeps items out of Personal (upstream's "Remove individual vault",
// OrganizationDataOwnership), is refused before it signs, as our apps refuse it
// (`App::passkey_assert` in passbundle-apps). Signing in raises its counter and saves the login,
// and the server refuses any change to such a login, so upstream's authenticator would sign and
// then fail to save. Signing without saving was turned down: docs/core.md in the meta repo,
// "Passkeys", "A counter that can't be saved", says why.
//
// How a passkey signs, its key, and the counter rule are unchanged. A passkey whose counter is 0
// has nothing to save, a login in a shared folder saves as before, and the organization's owners
// and admins aren't bound (upstream's policy service decides who is).

import { firstValueFrom } from "rxjs";

import { PolicyService } from "../../../../admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "../../../../admin-console/enums";
import { AccountService } from "../../../../auth/abstractions/account.service";
import { getUserId } from "../../../../auth/services/account.service";
import { CipherView } from "../../../../vault/models/view/cipher.view";
import {
  Fido2AuthenticatorError,
  Fido2AuthenticatorErrorCode,
} from "../../../abstractions/fido2/fido2-authenticator.service.abstraction";
import { Fido2UserInterfaceSession } from "../../../abstractions/fido2/fido2-user-interface.service.abstraction";

/** What the person is told, in our apps' words. The site never hears them. */
export const COUNTING_PASSKEY_KEPT_OUT =
  "Your organization keeps items out of Personal, so this login can't be changed. Its passkey counts its sign-ins, and signing in would change the login. You can move it to a shared folder in the web vault, then try again.";

/**
 * Whether signing in with this login's passkey needs a save the server will refuse: its passkey
 * counts (counter above 0), the login is the person's own (no organization), and an organization's
 * "Remove individual vault" binds the active account. The policy is only asked about for a
 * counting passkey in one of their own logins, so every other sign-in goes on as before, and so
 * does this one if the policies can't be read (the server still refuses the save then, as
 * upstream's authenticator always found out).
 */
export async function countingPasskeyKeptOut(
  cipher: CipherView,
  policyService: PolicyService | undefined,
  accountService: AccountService,
): Promise<boolean> {
  const passkey = cipher.login?.fido2Credentials?.[0];
  if (
    policyService == null ||
    passkey == null ||
    !(passkey.counter > 0) ||
    cipher.organizationId != null
  ) {
    return false;
  }
  try {
    const userId = await firstValueFrom(accountService.activeAccount$.pipe(getUserId));
    return await firstValueFrom(
      policyService.policyAppliesToUser$(PolicyType.OrganizationDataOwnership, userId),
    );
  } catch {
    return false;
  }
}

/**
 * Refuses a sign-in `countingPasskeyKeptOut` says can't be saved, before anything is raised,
 * saved, or signed: the person sees why where the extension shows a passkey error, and the site
 * gets upstream's usual error (NotAllowed), never the words. Otherwise it returns, and upstream's
 * authenticator signs as before.
 */
export async function refuseCountingPasskeyKeptOut(
  cipher: CipherView,
  session: Fido2UserInterfaceSession,
  policyService: PolicyService | undefined,
  accountService: AccountService,
): Promise<void> {
  if (!(await countingPasskeyKeptOut(cipher, policyService, accountService))) {
    return;
  }
  try {
    await session.informRefused?.(COUNTING_PASSKEY_KEPT_OUT);
  } catch {
    // The window was closed, or the site stopped waiting: refused all the same.
  }
  throw new Fido2AuthenticatorError(Fido2AuthenticatorErrorCode.NotAllowed);
}
