import { BaseResponse } from "../../../models/response/base.response";

export class IdentitySsoRequiredResponse extends BaseResponse {
  ssoOrganizationIdentifier: string | null;
  /**
   * Keykeeper: the organization requires single sign-on and this account isn't
   * linked to it yet, so the password and two-step login got a linking
   * session, which can only link it (DESIGN.md, "Sign in with Microsoft Entra
   * ID").
   */
  keykeeperSsoLinkSession: string | null;

  constructor(response: any) {
    super(response);
    this.ssoOrganizationIdentifier = this.getResponseProperty("SsoOrganizationIdentifier");
    this.keykeeperSsoLinkSession = this.getResponseProperty("KeykeeperSsoLinkSession") ?? null;
  }
}
