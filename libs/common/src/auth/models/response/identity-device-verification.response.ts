import { BaseResponse } from "../../../models/response/base.response";
import {
  KeykeeperNewDeviceCheck,
  keykeeperParseNewDeviceCheck,
} from "../../keykeeper/new-device-check";

export class IdentityDeviceVerificationResponse extends BaseResponse {
  deviceVerified: boolean;
  /**
   * Keykeeper: the new-device check this sign-in waits for: the number to
   * type on another device, and how it can be finished (DESIGN.md,
   * "New-device check").
   */
  keykeeperNewDeviceCheck: KeykeeperNewDeviceCheck | null;

  constructor(response: any) {
    super(response);
    this.deviceVerified = this.getResponseProperty("DeviceVerified") ?? false;
    this.keykeeperNewDeviceCheck = keykeeperParseNewDeviceCheck(
      this.getResponseProperty("KeykeeperNewDeviceCheck"),
    );
  }
}
