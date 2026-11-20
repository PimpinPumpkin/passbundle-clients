import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";

import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";

import { browserStorage } from "./msp-choice";
import { rememberSetUpMsp, takeSetUpMsp } from "./msp-setup";

/**
 * Keykeeper: /#/set-up-msp, the website's way in for an MSP signing up by
 * itself (msp-setup.ts). Someone signed in goes straight to the MSP console,
 * which offers "Set up your MSP" (or, locked, to unlock first, and then
 * there). Someone signed out goes to sign up, where "Log in" is one click away
 * for an existing account, and this browser remembers why they came.
 */
export const setUpMspGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const authService = inject(AuthService);
  let status = AuthenticationStatus.LoggedOut;
  try {
    status = await authService.getAuthStatus();
  } catch {
    // No account in this browser: as signed out.
  }
  if (status === AuthenticationStatus.LoggedOut) {
    rememberSetUpMsp(browserStorage(), Date.now());
    return router.createUrlTree(["/signup"]);
  }
  return router.createUrlTree(["/msp"]);
};

/**
 * Keykeeper: the first time the vault would open after someone came from
 * /#/set-up-msp and signed up or signed in, within a day, the MSP console
 * opens instead, at its "Set up your MSP" step. First on the vault's route, so
 * it comes before the offer to import and the extension's setup page.
 */
export const setUpMspRedirectGuard: CanActivateFn = () => {
  const router = inject(Router);
  return takeSetUpMsp(browserStorage(), Date.now()) ? router.createUrlTree(["/msp"]) : true;
};
