import { CUSTOM_ELEMENTS_SCHEMA } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of, ReplaySubject } from "rxjs";

import { AccountApiService } from "@bitwarden/common/auth/abstractions/account-api.service";
import { OrganizationInviteService } from "@bitwarden/common/auth/organization-invite";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import {
  EnvironmentService,
  Region,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { ValidationService } from "@bitwarden/common/platform/abstractions/validation.service";
import { DefaultServerSettingsService } from "@bitwarden/common/platform/services/default-server-settings.service";
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { AnonLayoutWrapperDataService } from "@bitwarden/components";

import { LoginEmailService } from "../../../common";
import { RegistrationEnvSelectorComponent } from "../registration-env-selector/registration-env-selector.component";

import { RegistrationStartComponent, RegistrationStartState } from "./registration-start.component";

/** A refusal at the first sign-up step, as the server answers it (status 400). */
function refusal(body: Record<string, unknown>) {
  return new ErrorResponse(
    { message: "Refused.", validationErrors: { "": ["Refused."] }, object: "error", ...body },
    400,
  );
}

// Keykeeper: the sign-up page on a server that isn't taking new accounts, or
// not for the address tried (DESIGN.md, "New accounts on a closed server").
describe("RegistrationStartComponent, on a server that may not take new accounts", () => {
  let fixture: ComponentFixture<RegistrationStartComponent>;
  let registrationDisabled$: ReplaySubject<boolean>;
  let registerSendVerificationEmail: jest.Mock;
  let navigate: jest.Mock;
  let anonLayout: { setAnonLayoutWrapperData: jest.Mock; resetToCachedRouteData: jest.Mock };

  const component = () => fixture.componentInstance;
  const el = () => fixture.nativeElement as HTMLElement;
  const form = () => el().querySelector("form");
  const sentence = () =>
    el()
      .querySelector('[data-testid="keykeeper-new-accounts-closed"]')
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
  const refused = () => el().querySelector('[data-testid="keykeeper-new-account-refused"]');

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Fills in an address and presses Continue. */
  async function signUpAs(email: string) {
    component().formGroup.patchValue({ email });
    const done = component().submit();
    await done.catch(() => undefined);
    await settle();
    return done;
  }

  beforeEach(async () => {
    registrationDisabled$ = new ReplaySubject<boolean>(1);
    registerSendVerificationEmail = jest.fn();
    navigate = jest.fn().mockResolvedValue(true);
    anonLayout = { setAnonLayoutWrapperData: jest.fn(), resetToCachedRouteData: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [RegistrationStartComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: Router, useValue: { navigate } },
        { provide: AccountApiService, useValue: { registerSendVerificationEmail } },
        {
          provide: DefaultServerSettingsService,
          useValue: { isUserRegistrationDisabled$: registrationDisabled$ },
        },
        {
          provide: EnvironmentService,
          useValue: { globalEnvironment$: of({ getRegion: () => Region.SelfHosted }) },
        },
        { provide: PlatformUtilsService, useValue: { isSelfHost: () => true } },
        {
          provide: LoginEmailService,
          useValue: { loginEmail$: new BehaviorSubject<string | null>(null) },
        },
        { provide: AnonLayoutWrapperDataService, useValue: anonLayout },
        { provide: OrganizationInviteService, useValue: { getOpenOrgInvite: async () => null } },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: ValidationService, useValue: mock<ValidationService>() },
        { provide: LogService, useValue: mock<LogService>() },
      ],
    })
      // The server menu has its own needs and nothing to do with these cases.
      .overrideComponent(RegistrationStartComponent, {
        remove: { imports: [RegistrationEnvSelectorComponent] },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(RegistrationStartComponent);
    await settle();
  });

  it("shows neither the form nor a sentence until the server's settings are in", () => {
    expect(form()).toBeNull();
    expect(sentence()).toBeUndefined();
  });

  it("says the server isn't taking new accounts, in place of the form", async () => {
    registrationDisabled$.next(true);
    await settle();

    expect(form()).toBeNull();
    expect(sentence()).toBe("keykeeperNewAccountsOwnServer");
    expect(registerSendVerificationEmail).not.toHaveBeenCalled();
  });

  it("shows the form on a server that takes new accounts", async () => {
    registrationDisabled$.next(false);
    await settle();

    expect(form()).not.toBeNull();
    expect(sentence()).toBeUndefined();
  });

  it("follows the server when its settings change", async () => {
    registrationDisabled$.next(true);
    await settle();
    registrationDisabled$.next(false);
    await settle();

    expect(form()).not.toBeNull();
    expect(sentence()).toBeUndefined();
  });

  describe("when the server turns the address down", () => {
    beforeEach(async () => {
      registrationDisabled$.next(false);
      await settle();
    });

    it("says new accounts aren't open for that address, in the form, and goes nowhere", async () => {
      registerSendVerificationEmail.mockRejectedValue(refusal({ keykeeperNewAccounts: "address" }));

      await expect(signUpAs("pat@elsewhere.example")).resolves.toBeUndefined();

      expect(refused()?.getAttribute("role")).toBe("alert");
      expect(sentence()).toBe("keykeeperNewAccountsNotThatAddressOwnServer");
      expect(form()).not.toBeNull();
      expect(component().state).toBe(RegistrationStartState.USER_DATA_ENTRY);
      expect(navigate).not.toHaveBeenCalled();
      expect(anonLayout.setAnonLayoutWrapperData).not.toHaveBeenCalled();
    });

    it("says the server isn't taking new accounts when that's the server's reason", async () => {
      registerSendVerificationEmail.mockRejectedValue(refusal({ keykeeperNewAccounts: "closed" }));

      await expect(signUpAs("pat@elsewhere.example")).resolves.toBeUndefined();

      expect(sentence()).toBe("keykeeperNewAccountsOwnServer");
      expect(form()).not.toBeNull();
    });

    it("takes the sentence away once the address changes", async () => {
      registerSendVerificationEmail.mockRejectedValue(refusal({ keykeeperNewAccounts: "address" }));
      await signUpAs("pat@elsewhere.example");
      expect(refused()).not.toBeNull();

      component().formGroup.patchValue({ email: "pat@allowed.example" });
      await settle();

      expect(refused()).toBeNull();
    });

    it("takes the sentence away when the next try goes through", async () => {
      registerSendVerificationEmail.mockRejectedValueOnce(
        refusal({ keykeeperNewAccounts: "address" }),
      );
      await signUpAs("pat@elsewhere.example");
      registerSendVerificationEmail.mockResolvedValueOnce("a-token");

      await signUpAs("pat@elsewhere.example");

      expect(refused()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(["/finish-signup"], {
        queryParams: { token: "a-token", email: "pat@elsewhere.example" },
      });
    });

    it.each([
      ["a server that gives no reason", refusal({})],
      ["a reason this app doesn't know", refusal({ keykeeperNewAccounts: "later" })],
      ["something else going wrong", new Error("offline")],
    ])("passes the error on as before for %s", async (_, error) => {
      registerSendVerificationEmail.mockRejectedValue(error);

      await expect(signUpAs("pat@elsewhere.example")).rejects.toBe(error);

      expect(refused()).toBeNull();
      expect(sentence()).toBeUndefined();
    });
  });

  describe("when the server takes the address", () => {
    beforeEach(async () => {
      registrationDisabled$.next(false);
      await settle();
    });

    it("goes on to the rest of sign-up with the server's token, as before", async () => {
      registerSendVerificationEmail.mockResolvedValue("a-token");

      await signUpAs("pat@allowed.example");

      expect(navigate).toHaveBeenCalledWith(["/finish-signup"], {
        queryParams: { token: "a-token", email: "pat@allowed.example" },
      });
      expect(refused()).toBeNull();
    });

    it("asks to check email when the server sends a link, as before", async () => {
      registerSendVerificationEmail.mockResolvedValue(null);

      await signUpAs("pat@allowed.example");

      expect(component().state).toBe(RegistrationStartState.CHECK_EMAIL);
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
