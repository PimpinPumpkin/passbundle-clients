import { ClientType } from "../../../../enums";

import { DeviceRequest } from "./device.request";
import { TokenTwoFactorRequest } from "./token-two-factor.request";
import { TokenRequest } from "./token.request";

export class PasswordTokenRequest extends TokenRequest {
  /**
   * Keykeeper: the token of the new-device check this sign-in waits for
   * (DESIGN.md, "New-device check"). Never sent on its own: signing in again
   * while the check waits sends it as `newDeviceOtp`, so the server continues
   * the same check, which has one holder, instead of starting a new one.
   */
  keykeeperNewDeviceToken?: string;

  constructor(
    public email: string,
    public masterPasswordHash: string,
    protected twoFactor: TokenTwoFactorRequest,
    device?: DeviceRequest,
    public newDeviceOtp?: string,
  ) {
    super(twoFactor, device);
  }

  toIdentityToken(clientId: ClientType) {
    const obj = super.toIdentityToken(clientId);

    obj.grant_type = "password";
    obj.username = this.email;
    obj.password = this.masterPasswordHash;

    if (this.newDeviceOtp) {
      obj.newDeviceOtp = this.newDeviceOtp;
    }

    return obj;
  }

  static fromJSON(json: any) {
    return Object.assign(Object.create(PasswordTokenRequest.prototype), json, {
      device: json.device ? DeviceRequest.fromJSON(json.device) : undefined,
      twoFactor: json.twoFactor
        ? Object.assign(new TokenTwoFactorRequest(), json.twoFactor)
        : undefined,
    });
  }
}
