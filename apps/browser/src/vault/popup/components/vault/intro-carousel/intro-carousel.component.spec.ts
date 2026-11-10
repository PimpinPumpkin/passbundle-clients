import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { mock } from "jest-mock-extended";
import { of, ReplaySubject } from "rxjs";

import { consumeDefaultPasswordManagerSuccessToast } from "@bitwarden/browser/autofill/default-password-manager-session.util";
import { IntroCarouselComponent } from "@bitwarden/browser/vault/popup/components/vault/intro-carousel/intro-carousel.component";
import { IntroCarouselService } from "@bitwarden/browser/vault/popup/services/intro-carousel.service";
import {
  EnvironmentService,
  Region,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DefaultServerSettingsService } from "@bitwarden/common/platform/services/default-server-settings.service";
import { ToastService } from "@bitwarden/components";

jest.mock("@bitwarden/browser/autofill/default-password-manager-session.util", () => ({
  consumeDefaultPasswordManagerSuccessToast: jest.fn().mockResolvedValue(false),
}));

describe("IntroCarouselComponent", () => {
  let component: IntroCarouselComponent;
  let fixture: ComponentFixture<IntroCarouselComponent>;
  let mockRouter: Router;
  let mockIntroCarouselService: IntroCarouselService;
  let mockToastService: ToastService;
  let mockI18nService: I18nService;
  let navigateSpy: jest.SpyInstance;
  let carouselDismissedSpy: jest.SpyInstance;
  // Keykeeper: whether the server takes new accounts, as its settings say once they're in.
  let registrationDisabled$: ReplaySubject<boolean>;

  beforeEach(async () => {
    registrationDisabled$ = new ReplaySubject<boolean>(1);
    mockRouter = mock<Router>();
    mockIntroCarouselService = mock<IntroCarouselService>();
    mockToastService = mock<ToastService>();
    mockI18nService = mock<I18nService>();

    await TestBed.configureTestingModule({
      imports: [],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: IntroCarouselService, useValue: mockIntroCarouselService },
        { provide: ToastService, useValue: mockToastService },
        { provide: I18nService, useValue: mockI18nService },
        {
          provide: DefaultServerSettingsService,
          useValue: { isUserRegistrationDisabled$: registrationDisabled$ },
        },
        {
          provide: EnvironmentService,
          useValue: { globalEnvironment$: of({ getRegion: () => Region.US }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IntroCarouselComponent);
    component = fixture.componentInstance;

    navigateSpy = jest.spyOn(mockRouter, "navigate").mockResolvedValue(true);
    carouselDismissedSpy = jest
      .spyOn(mockIntroCarouselService, "setIntroCarouselDismissed")
      .mockResolvedValue();
    jest.mocked(consumeDefaultPasswordManagerSuccessToast).mockResolvedValue(false);
    fixture.detectChanges();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("should show success toast when default password manager was applied", async () => {
    jest.mocked(consumeDefaultPasswordManagerSuccessToast).mockResolvedValue(true);
    jest
      .spyOn(mockI18nService, "t")
      .mockReturnValue("Made Bitwarden your default browser password manager");
    await component.ngOnInit();

    expect(mockToastService.showToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Made Bitwarden your default browser password manager",
    });
  });

  describe("navigateToSignup", () => {
    it("should set intro carousel as dismissed and navigate to signup", async () => {
      await component["navigateToSignup"]();

      expect(carouselDismissedSpy).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(["/signup"]);
    });
  });

  describe("navigateToLogin", () => {
    it("should set intro carousel as dismissed and navigate to login", async () => {
      await component["navigateToLogin"]();

      expect(carouselDismissedSpy).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(["/login"]);
    });
  });

  // Keykeeper: Create account only where it works (DESIGN.md, "New accounts on a closed server").
  describe("on a server that may not take new accounts", () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const createAccount = () =>
      el().querySelector<HTMLButtonElement>('[data-testid="intro-create-account"]');
    const closed = () => el().querySelector('[data-testid="keykeeper-new-accounts-closed"]');
    const buttons = () => [...el().querySelectorAll<HTMLButtonElement>("button[bitButton]")];

    it("keeps Create account out of sight until the server's settings are in", () => {
      expect(createAccount()?.classList).toContain("tw-invisible");
      expect(closed()).toBeNull();
    });

    it("offers Create account on a server that takes new accounts", () => {
      registrationDisabled$.next(false);
      fixture.detectChanges();

      expect(createAccount()).not.toBeNull();
      expect(createAccount()?.classList).not.toContain("tw-invisible");
      expect(closed()).toBeNull();
      expect(buttons()).toHaveLength(2);
    });

    it("says new accounts aren't open, with no Create account button, on a server that doesn't", () => {
      registrationDisabled$.next(true);
      fixture.detectChanges();

      expect(createAccount()).toBeNull();
      expect(closed()).not.toBeNull();
      // Signing in is all that's left to press.
      expect(buttons()).toHaveLength(1);
    });
  });
});
