import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { UserNamePipe } from "@bitwarden/angular/pipes/user-name.pipe";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationManagementPreferencesService } from "@bitwarden/common/admin-console/abstractions/organization-management-preferences/organization-management-preferences.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { StateService } from "@bitwarden/common/platform/abstractions/state.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { EmergencyAccessService } from "../../emergency-access";

import { EmergencyAccessAddEditComponent } from "./emergency-access-add-edit.component";
import { EmergencyAccessComponent } from "./emergency-access.component";

// Keykeeper: legacy contacts are free (DESIGN.md, "Plans and billing").
// Upstream made the page read-only without Premium.
describe("EmergencyAccessComponent", () => {
  let component: EmergencyAccessComponent;
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    const configService = mock<ConfigService>();
    configService.getFeatureFlag$.mockReturnValue(of(false));
    const userNamePipe = mock<UserNamePipe>();
    userNamePipe.transform.mockReturnValue("Ana");

    TestBed.configureTestingModule({});
    component = TestBed.runInInjectionContext(
      () =>
        new EmergencyAccessComponent(
          mock<EmergencyAccessService>(),
          mock<I18nService>(),
          mock<PlatformUtilsService>(),
          mock<MessagingService>(),
          userNamePipe,
          mock<LogService>(),
          mock<StateService>(),
          mock<OrganizationService>(),
          mock<DialogService>(),
          mock<OrganizationManagementPreferencesService>(),
          mock<ToastService>(),
          mock<ApiService>(),
          mock<AccountService>(),
          configService,
        ),
    );
    openSpy = jest
      .spyOn(EmergencyAccessAddEditComponent, "open")
      .mockReturnValue({ closed: of(undefined) } as never);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it("opens the window to add a legacy contact without asking about the plan", async () => {
    await component.invite();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][1]).toEqual({
      data: expect.objectContaining({ readOnly: false }),
    });
  });

  it("opens an existing legacy contact to change, never read-only", async () => {
    await component.edit({ id: "contact-1", email: "ana@example.com" } as never);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][1]).toEqual({
      data: expect.objectContaining({ emergencyAccessId: "contact-1", readOnly: false }),
    });
  });
});
