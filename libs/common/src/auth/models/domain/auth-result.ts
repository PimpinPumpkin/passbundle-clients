// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Utils } from "../../../platform/misc/utils";
import { UserId } from "../../../types/guid";
import { TwoFactorProviderType } from "../../enums/two-factor-provider-type";

export class AuthResult {
  userId: UserId;
  twoFactorProviders: Partial<Record<TwoFactorProviderType, Record<string, string>>> = null;
  ssoEmail2FaSessionToken?: string;
  email: string;
  requiresEncryptionKeyMigration: boolean;
  requiresDeviceVerification: boolean;
  ssoOrganizationIdentifier?: string | null;
  /** Keykeeper: a linking session, when the account must link to that single sign-on first. */
  keykeeperSsoLinkSession?: string | null;
  /**
   * Keykeeper: a setup session, when the account's role requires two-step
   * login and it isn't set up yet. The password sign-in's server hash comes
   * along (in memory only), since the setup endpoints still ask for it.
   */
  keykeeperTwoStepSetup?: {
    token: string;
    requiredBy: string[];
    message: string;
    email: string | null;
    masterPasswordHash: string | null;
  } | null;
  // The master-password used in the authentication process
  masterPassword: string | null;

  get requiresTwoFactor() {
    return this.twoFactorProviders != null;
  }

  // This is not as extensible as an object-based approach. In the future we may need to adjust to an object based approach.
  get requiresSso() {
    return !Utils.isNullOrWhitespace(this.ssoOrganizationIdentifier);
  }
}
