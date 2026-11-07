import { ComponentFixture, TestBed } from "@angular/core/testing";
import { RouterTestingModule } from "@angular/router/testing";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, Subject } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { MessageListener } from "@bitwarden/common/platform/messaging";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { FakeAccountService, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { BannerModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { VerifyEmailComponent } from "../../../auth/settings/verify-email.component";
import { SharedModule } from "../../../shared";

import { VaultBannersService, VisibleVaultBanner } from "./services/vault-banners.service";
import { VaultBannersComponent } from "./vault-banners.component";

describe("VaultBannersComponent", () => {
  let component: VaultBannersComponent;
  let fixture: ComponentFixture<VaultBannersComponent>;
  let messageSubject: Subject<{ command: string }>;
  const premiumBanner$ = new BehaviorSubject<boolean>(false);
  const pendingAuthRequest$ = new BehaviorSubject<boolean>(false);
  // Keykeeper: the verify email banner follows the service's answer as it changes.
  const verifyEmail$ = new BehaviorSubject<boolean>(false);
  const mockUserId = Utils.newGuid() as UserId;

  const bannerService = mock<VaultBannersService>({
    shouldShowUpdateBrowserBanner: jest.fn(),
    shouldShowVerifyEmailBanner: jest.fn(),
    shouldShowVerifyEmailBanner$: jest.fn((userId: UserId) => verifyEmail$.asObservable()),
    shouldShowPendingAuthRequestBanner: jest.fn((userId: UserId) =>
      Promise.resolve(pendingAuthRequest$.value),
    ),
    dismissBanner: jest.fn(),
  });

  const accountService: FakeAccountService = mockAccountServiceWith(mockUserId);

  beforeEach(async () => {
    messageSubject = new Subject<{ command: string }>();
    bannerService.shouldShowUpdateBrowserBanner.mockResolvedValue(false);
    bannerService.shouldShowVerifyEmailBanner.mockResolvedValue(false);
    pendingAuthRequest$.next(false);
    verifyEmail$.next(false);
    premiumBanner$.next(false);

    await TestBed.configureTestingModule({
      imports: [
        BannerModule,
        SharedModule,
        VerifyEmailComponent,
        VaultBannersComponent,
        RouterTestingModule,
        I18nPipe,
      ],
      providers: [
        {
          provide: I18nService,
          useValue: mock<I18nService>({ t: (key) => key }),
        },
        {
          provide: ApiService,
          useValue: mock<ApiService>(),
        },
        {
          provide: PlatformUtilsService,
          useValue: mock<PlatformUtilsService>(),
        },
        {
          provide: TokenService,
          useValue: mock<TokenService>(),
        },
        {
          provide: AccountService,
          useValue: accountService,
        },
        {
          provide: MessageListener,
          useValue: mock<MessageListener>({
            allMessages$: messageSubject.asObservable(),
          }),
        },
      ],
    })
      .overrideProvider(VaultBannersService, { useValue: bannerService })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(VaultBannersComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
  });

  describe("determineVisibleBanner", () => {
    [
      {
        name: "OutdatedBrowser",
        method: bannerService.shouldShowUpdateBrowserBanner,
        banner: VisibleVaultBanner.OutdatedBrowser,
      },
    ].forEach(({ name, method, banner }) => {
      describe(name, () => {
        beforeEach(async () => {
          method.mockResolvedValue(true);

          await component.ngOnInit();
          fixture.detectChanges();
        });

        it(`shows ${name} banner`, async () => {
          expect(component.visibleBanners).toEqual([banner]);
        });

        it(`dismisses ${name} banner`, async () => {
          const dismissButton = fixture.debugElement.nativeElement.querySelector(
            'button[biticonbutton="bwi-close"]',
          );

          // Mock out the banner service returning false after dismissing
          method.mockResolvedValue(false);

          dismissButton.dispatchEvent(new Event("click"));

          expect(bannerService.dismissBanner).toHaveBeenCalledWith(mockUserId, banner);

          expect(component.visibleBanners).toEqual([]);
        });
      });
    });

    // Keykeeper: shown and hidden as the account changes, not decided once.
    describe("VerifyEmail", () => {
      const banner = () => fixture.debugElement.nativeElement.querySelector("#verify-email-banner");

      beforeEach(async () => {
        verifyEmail$.next(true);

        await component.ngOnInit();
        fixture.detectChanges();
      });

      it("shows VerifyEmail banner", async () => {
        expect(component.visibleBanners).toEqual([VisibleVaultBanner.VerifyEmail]);
        expect(banner()).not.toBeNull();
      });

      it("dismisses VerifyEmail banner", async () => {
        const dismissButton = fixture.debugElement.nativeElement.querySelector(
          'button[biticonbutton="bwi-close"]',
        );

        dismissButton.dispatchEvent(new Event("click"));
        await fixture.whenStable();

        expect(bannerService.dismissBanner).toHaveBeenCalledWith(
          mockUserId,
          VisibleVaultBanner.VerifyEmail,
        );

        // The service's answer turns false once it's dismissed.
        verifyEmail$.next(false);
        fixture.detectChanges();

        expect(component.visibleBanners).toEqual([]);
        expect(banner()).toBeNull();
      });

      it("goes away as soon as the email is verified, with the vault still open", () => {
        expect(banner()).not.toBeNull();

        // A sync (after verifying, even on another device) updates the account.
        verifyEmail$.next(false);
        fixture.detectChanges();

        expect(component.visibleBanners).toEqual([]);
        expect(banner()).toBeNull();
      });

      it("stays away when the banners are worked out again", async () => {
        expect(banner()).not.toBeNull();
        verifyEmail$.next(false);
        await component.determineVisibleBanners();
        fixture.detectChanges();

        expect(component.visibleBanners).toEqual([]);
        expect(banner()).toBeNull();
      });

      it("keeps the other banners when it goes", async () => {
        pendingAuthRequest$.next(true);
        await component.determineVisibleBanners();
        expect(component.visibleBanners).toContain(VisibleVaultBanner.VerifyEmail);

        verifyEmail$.next(false);
        fixture.detectChanges();

        expect(component.visibleBanners).toEqual([VisibleVaultBanner.PendingAuthRequest]);
      });
    });

    describe("PendingAuthRequest", () => {
      beforeEach(async () => {
        pendingAuthRequest$.next(true);
        await component.ngOnInit();
        fixture.detectChanges();
      });

      it("shows pending auth request banner", async () => {
        expect(component.visibleBanners).toEqual([VisibleVaultBanner.PendingAuthRequest]);
      });

      it("dismisses pending auth request banner", async () => {
        const dismissButton = fixture.debugElement.nativeElement.querySelector(
          'button[biticonbutton="bwi-close"]',
        );

        pendingAuthRequest$.next(false);
        dismissButton.click();
        fixture.detectChanges();

        expect(bannerService.dismissBanner).toHaveBeenCalledWith(
          mockUserId,
          VisibleVaultBanner.PendingAuthRequest,
        );

        // Wait for async operations to complete
        await fixture.whenStable();
        await component.determineVisibleBanners();
        fixture.detectChanges();

        expect(component.visibleBanners).toEqual([]);
      });
    });
  });

  describe("message listener", () => {
    beforeEach(async () => {
      bannerService.shouldShowPendingAuthRequestBanner.mockResolvedValue(true);
      messageSubject.next({ command: "openLoginApproval" });
      fixture.detectChanges();
    });

    it("adds pending auth request banner when openLoginApproval message is received", async () => {
      await component.ngOnInit();
      messageSubject.next({ command: "openLoginApproval" });
      fixture.detectChanges();

      expect(component.visibleBanners).toContain(VisibleVaultBanner.PendingAuthRequest);
    });

    it("does not add duplicate pending auth request banner", async () => {
      await component.ngOnInit();
      messageSubject.next({ command: "openLoginApproval" });
      messageSubject.next({ command: "openLoginApproval" });
      fixture.detectChanges();

      const bannerCount = component.visibleBanners.filter(
        (b) => b === VisibleVaultBanner.PendingAuthRequest,
      ).length;
      expect(bannerCount).toBe(1);
    });

    it("ignores other message types", async () => {
      bannerService.shouldShowPendingAuthRequestBanner.mockResolvedValue(false);
      await component.ngOnInit();
      messageSubject.next({ command: "someOtherCommand" });
      fixture.detectChanges();

      expect(component.visibleBanners).not.toContain(VisibleVaultBanner.PendingAuthRequest);
    });
  });
});
