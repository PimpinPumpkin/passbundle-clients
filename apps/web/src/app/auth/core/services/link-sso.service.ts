import { firstValueFrom } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { SsoLoginServiceAbstraction } from "@bitwarden/common/auth/abstractions/sso-login.service.abstraction";
import { SecretVerificationRequest } from "@bitwarden/common/auth/models/request/secret-verification.request";
import { CryptoFunctionService } from "@bitwarden/common/key-management/crypto/abstractions/crypto-function.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import {
  PasswordGenerationServiceAbstraction,
  PasswordGeneratorOptions,
} from "@bitwarden/generator-legacy";

/**
 * Provides a service for linking SSO.
 */
export class LinkSsoService {
  constructor(
    private ssoLoginService: SsoLoginServiceAbstraction,
    private apiService: ApiService,
    private cryptoFunctionService: CryptoFunctionService,
    private environmentService: EnvironmentService,
    private passwordGenerationService: PasswordGenerationServiceAbstraction,
    private platformUtilsService: PlatformUtilsService,
  ) {}

  /**
   * Links SSO to an organization.
   * Ported from the SsoComponent
   * @param identifier The identifier of the organization to link to.
   * @param verification Keykeeper: the master password or a one-time code,
   *   which the server checks before it issues a ticket to link with.
   */
  async linkSso(identifier: string, verification: SecretVerificationRequest) {
    if (identifier == null || identifier === "") {
      throw new Error("SSO identifier is required");
    }

    const redirectUri = window.location.origin + "/sso-connector.html";
    const clientId = "web";

    const response = await this.apiService.preValidateSso(identifier);

    const passwordOptions: PasswordGeneratorOptions = {
      type: "password",
      length: 64,
      uppercase: true,
      lowercase: true,
      number: true,
      special: false,
    };

    const codeVerifier = await this.passwordGenerationService.generatePassword(passwordOptions);
    const codeVerifierHash = await this.cryptoFunctionService.hash(codeVerifier, "sha256");
    const codeChallenge = Utils.fromArrayToUrlB64(codeVerifierHash);
    await this.ssoLoginService.setCodeVerifier(codeVerifier);

    // Keykeeper: Microsoft's answer comes back to the web vault's /sso-link
    // page, where this session confirms the link (DESIGN.md, "Sign in with
    // Microsoft Entra ID"), so the state carries no return address.
    let state = await this.passwordGenerationService.generatePassword(passwordOptions);
    state += `_identifier=${identifier}`;

    // Save state
    await this.ssoLoginService.setSsoState(state);

    const env = await firstValueFrom(this.environmentService.environment$);

    let authorizeUrl =
      env.getIdentityUrl() +
      "/connect/authorize?" +
      "client_id=" +
      clientId +
      "&redirect_uri=" +
      encodeURIComponent(redirectUri) +
      "&" +
      "response_type=code&scope=api offline_access&" +
      "state=" +
      state +
      "&code_challenge=" +
      codeChallenge +
      "&" +
      "code_challenge_method=S256&response_mode=query&" +
      "domain_hint=" +
      encodeURIComponent(identifier) +
      "&ssoToken=" +
      encodeURIComponent(response.token);

    // Keykeeper: a ticket for this session, which works once, within five
    // minutes, from this browser only (the answer sets a cookie it needs).
    const userIdentifier: string = await this.apiService.send(
      "POST",
      "/accounts/sso/user-identifier",
      verification,
      true,
      true,
    );
    authorizeUrl += `&user_identifier=${encodeURIComponent(userIdentifier)}`;

    this.platformUtilsService.launchUri(authorizeUrl, { sameWindow: true });
  }
}
