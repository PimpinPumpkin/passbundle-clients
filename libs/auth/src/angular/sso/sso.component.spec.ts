import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import {
  LoginStrategyServiceAbstraction,
  LoginSuccessHandlerService,
  UserDecryptionOptionsServiceAbstraction,
} from "@bitwarden/auth/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrgDomainApiServiceAbstraction } from "@bitwarden/common/admin-console/abstractions/organization-domain/org-domain-api.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { SsoLoginServiceAbstraction } from "@bitwarden/common/auth/abstractions/sso-login.service.abstraction";
import { SsoPreValidateResponse } from "@bitwarden/common/auth/models/response/sso-pre-validate.response";
import { ClientType } from "@bitwarden/common/enums";
import { KeyConnectorService } from "@bitwarden/common/key-management/key-connector/abstractions/key-connector.service";
import { InternalMasterPasswordServiceAbstraction } from "@bitwarden/common/key-management/master-password/abstractions/master-password.service.abstraction";
import {
  Environment,
  EnvironmentService,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { ValidationService } from "@bitwarden/common/platform/abstractions/validation.service";
// eslint-disable-next-line no-restricted-imports
import { DialogService, ToastService } from "@bitwarden/components";
import { PasswordGenerationServiceAbstraction } from "@bitwarden/generator-legacy";
// eslint-disable-next-line no-restricted-imports
import { CryptoFunctionService } from "@bitwarden/legacy-crypto";

import { SsoComponentService } from "./sso-component.service";
import { SsoComponent } from "./sso.component";

// Keykeeper: the page's Continue in an app that hands single sign-on off to
// the web vault (the browser extension, after a refused sign-in) starts again
// there; everywhere else it goes on to the identity provider, as upstream's
// does. See DESIGN.md, "Sign in with Microsoft Entra ID".
describe("SsoComponent's Continue", () => {
  let ssoLoginService: MockProxy<SsoLoginServiceAbstraction>;
  let apiService: MockProxy<ApiService>;
  let platformUtilsService: MockProxy<PlatformUtilsService>;
  let validationService: MockProxy<ValidationService>;
  let passwordGenerationService: MockProxy<PasswordGenerationServiceAbstraction>;
  let cryptoFunctionService: MockProxy<CryptoFunctionService>;

  function create(clientType: ClientType, ssoComponentService: SsoComponentService) {
    ssoLoginService = mock<SsoLoginServiceAbstraction>();
    apiService = mock<ApiService>();
    platformUtilsService = mock<PlatformUtilsService>();
    platformUtilsService.getClientType.mockReturnValue(clientType);
    validationService = mock<ValidationService>();
    passwordGenerationService = mock<PasswordGenerationServiceAbstraction>();
    passwordGenerationService.generatePassword.mockResolvedValue("generated");
    cryptoFunctionService = mock<CryptoFunctionService>();
    cryptoFunctionService.hash.mockResolvedValue(new Uint8Array(32));
    const environmentService = mock<EnvironmentService>();
    environmentService.globalEnvironment$ = of({
      getWebVaultUrl: () => "https://vault.example.test",
      getIdentityUrl: () => "https://vault.example.test/identity",
    } as Environment);
    const route = { queryParams: of({}) } as unknown as ActivatedRoute;

    TestBed.configureTestingModule({
      providers: [{ provide: DialogService, useValue: mock<DialogService>() }],
    });
    return TestBed.runInInjectionContext(
      () =>
        new SsoComponent(
          ssoLoginService,
          mock<LoginStrategyServiceAbstraction>(),
          mock<Router>(),
          mock<I18nService>(),
          route,
          mock<OrgDomainApiServiceAbstraction>(),
          validationService,
          platformUtilsService,
          apiService,
          cryptoFunctionService,
          environmentService,
          passwordGenerationService,
          mock<LogService>(),
          mock<UserDecryptionOptionsServiceAbstraction>(),
          mock<InternalMasterPasswordServiceAbstraction>(),
          mock<AccountService>(),
          mock<ToastService>(),
          ssoComponentService,
          mock<LoginSuccessHandlerService>(),
          mock<KeyConnectorService>(),
        ),
    );
  }

  /** The person's identifier in the form, and the email the sign-in started with. */
  function filledIn(component: SsoComponent, email: string | null, identifier: string) {
    (component as unknown as { email: string | null }).email = email;
    (
      component as unknown as {
        formGroup: { controls: { identifier: { setValue(v: string): void } } };
      }
    ).formGroup.controls.identifier.setValue(identifier);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("in the extension, hands off to the web vault with the email and identifier, and never goes to the identity provider from this page", async () => {
    const keykeeperHandOff = jest.fn().mockResolvedValue(undefined);
    const component = create(ClientType.Browser, { keykeeperHandOff });
    filledIn(component, "ana@fabrikam.test", "fabrikam");

    await component.submit();

    expect(keykeeperHandOff).toHaveBeenCalledWith("ana@fabrikam.test", "fabrikam");
    expect(ssoLoginService.setOrganizationSsoIdentifier).toHaveBeenCalledWith("fabrikam");
    expect(apiService.preValidateSso).not.toHaveBeenCalled();
    expect(platformUtilsService.launchUri).not.toHaveBeenCalled();
  });

  it("in the extension, hands off without an email when the sign-in had none", async () => {
    const keykeeperHandOff = jest.fn().mockResolvedValue(undefined);
    const component = create(ClientType.Browser, { keykeeperHandOff });
    filledIn(component, null, "fabrikam");

    await component.submit();

    expect(keykeeperHandOff).toHaveBeenCalledWith("", "fabrikam");
  });

  it("in the extension, says why when the hand-off fails", async () => {
    const error = new Error("no web vault");
    const component = create(ClientType.Browser, {
      keykeeperHandOff: jest.fn().mockRejectedValue(error),
    });
    filledIn(component, "ana@fabrikam.test", "fabrikam");

    await component.submit();

    expect(validationService.showError).toHaveBeenCalledWith(error);
    expect(platformUtilsService.launchUri).not.toHaveBeenCalled();
  });

  it("in the web vault, checks the identifier and goes on to the identity provider, as upstream's does", async () => {
    const component = create(ClientType.Web, {});
    filledIn(component, "ana@fabrikam.test", "fabrikam");
    apiService.preValidateSso.mockResolvedValue({
      token: "prevalidated",
    } as SsoPreValidateResponse);

    await component.submit();

    expect(apiService.preValidateSso).toHaveBeenCalledWith("fabrikam");
    expect(platformUtilsService.launchUri).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/vault\.example\.test\/identity\/connect\/authorize\?client_id=web&redirect_uri=https%3A%2F%2Fvault\.example\.test%2Fsso-connector\.html&.*domain_hint=fabrikam&ssoToken=prevalidated$/,
      ),
      { sameWindow: true },
    );
  });
});
