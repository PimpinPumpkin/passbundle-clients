import { TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { LoginComponentService } from "@bitwarden/auth/angular";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import {
  EnvironmentService,
  Environment,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";

import { BrowserApi } from "../../../platform/browser/browser-api";

import { ExtensionSsoComponentService } from "./extension-sso-component.service";

describe("ExtensionSsoComponentService", () => {
  let service: ExtensionSsoComponentService;
  const baseUrl = "https://vault.bitwarden.com";

  let syncService: MockProxy<SyncService>;
  let authService: MockProxy<AuthService>;
  let environmentService: MockProxy<EnvironmentService>;
  let i18nService: MockProxy<I18nService>;
  let logService: MockProxy<LogService>;
  let loginComponentService: MockProxy<LoginComponentService>;

  beforeEach(() => {
    syncService = mock<SyncService>();
    authService = mock<AuthService>();
    environmentService = mock<EnvironmentService>();
    i18nService = mock<I18nService>();
    logService = mock<LogService>();
    loginComponentService = mock<LoginComponentService>();
    environmentService.environment$ = new BehaviorSubject<Environment>({
      getWebVaultUrl: () => baseUrl,
    } as Environment);

    TestBed.configureTestingModule({
      providers: [
        { provide: SyncService, useValue: syncService },
        { provide: AuthService, useValue: authService },
        { provide: EnvironmentService, useValue: environmentService },
        { provide: I18nService, useValue: i18nService },
        { provide: LogService, useValue: logService },
        { provide: LoginComponentService, useValue: loginComponentService },
        ExtensionSsoComponentService,
      ],
    });

    service = TestBed.inject(ExtensionSsoComponentService);

    jest.spyOn(BrowserApi, "reloadOpenWindows").mockImplementation();
  });

  it("creates the service", () => {
    expect(service).toBeTruthy();
  });

  describe("closeWindow", () => {
    it("closes window", async () => {
      const windowSpy = jest.spyOn(window, "close").mockImplementation();

      await service.closeWindow?.();

      expect(windowSpy).toHaveBeenCalled();
    });
  });

  // Keykeeper: the window that finishes single sign-on offers the identifier
  // again after a refusal. Sent to Microsoft from there, the answer would end
  // on the web vault's sign-in page and never reach the extension.
  describe("keykeeperHandOff", () => {
    it("starts again through the web vault, as the sign-in page does", async () => {
      await service.keykeeperHandOff("ana@fabrikam.test", "fabrikam");

      expect(
        loginComponentService.redirectToSsoLoginWithOrganizationSsoIdentifier,
      ).toHaveBeenCalledWith("ana@fabrikam.test", "fabrikam");
    });
  });
});
