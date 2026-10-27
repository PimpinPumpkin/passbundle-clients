import { BaseResponse } from "../../../models/response/base.response";

/**
 * Keykeeper: the sign-in checked out, but the person's role requires two-step
 * login (an authenticator app, a security key or passkey, or Duo) and they
 * haven't set it up. The server answered with a setup session instead of a
 * login: a token only its two-step setup endpoints take, for fifteen minutes.
 * See DESIGN.md, "Two-step login for admins".
 */
export class IdentityKeykeeperTwoStepSetupResponse extends BaseResponse {
  /** The setup session's token. */
  token: string;
  /** Who requires it: organizations, and MSPs of their staff. */
  requiredBy: string[];
  /** The server's sentence about it, which names the web vault. */
  message: string;

  constructor(response: any) {
    super(response);
    this.token = this.getResponseProperty("KeykeeperTwoStepSetup");
    this.requiredBy = this.getResponseProperty("KeykeeperTwoStepRequiredBy") ?? [];
    this.message =
      this.getResponseProperty("ErrorModel")?.Message ??
      this.getResponseProperty("error_description") ??
      "";
  }
}
