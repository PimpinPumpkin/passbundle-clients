import { TestBed } from "@angular/core/testing";
import { BehaviorSubject } from "rxjs";

import { AuthRequestServiceAbstraction } from "@bitwarden/auth/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthRequestResponse } from "@bitwarden/common/auth/models/response/auth-request.response";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { DeviceType } from "@bitwarden/common/enums";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { StateProvider } from "@bitwarden/common/platform/state";
import {
  FakeStateProvider,
  mockAccountServiceWith,
  mockAccountInfoWith,
} from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";

import { VaultBannersService, VisibleVaultBanner } from "./vault-banners.service";

describe("VaultBannersService", () => {
  let service: VaultBannersService;
  const isSelfHost = jest.fn().mockReturnValue(false);
  const hasPremiumFromAnySource$ = new BehaviorSubject<boolean>(false);
  const userId = Utils.newGuid() as UserId;
  const fakeStateProvider = new FakeStateProvider(mockAccountServiceWith(userId));
  const getEmailVerified = jest.fn().mockResolvedValue(true);
  const lastSync$ = new BehaviorSubject<Date | null>(null);
  const accounts$ = new BehaviorSubject({
    [userId]: mockAccountInfoWith({
      email: "test@bitwarden.com",
      name: "name",
    }),
  });
  const pendingAuthRequests$ = new BehaviorSubject<Array<AuthRequestResponse>>([]);

  beforeEach(() => {
    lastSync$.next(new Date("2024-05-14"));
    isSelfHost.mockClear();
    getEmailVerified.mockClear().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        VaultBannersService,
        {
          provide: PlatformUtilsService,
          useValue: { isSelfHost },
        },
        {
          provide: BillingAccountProfileStateService,
          useValue: { hasPremiumFromAnySource$: () => hasPremiumFromAnySource$ },
        },
        {
          provide: StateProvider,
          useValue: fakeStateProvider,
        },
        {
          provide: AccountService,
          useValue: { accounts$ },
        },
        {
          provide: SyncService,
          useValue: { lastSync$: () => lastSync$ },
        },
        {
          provide: AuthRequestServiceAbstraction,
          useValue: { getPendingAuthRequests$: () => pendingAuthRequests$ },
        },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("OutdatedBrowser", () => {
    beforeEach(async () => {
      // Hardcode `MSIE` in userAgent string
      const userAgent = "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 MSIE";
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () => userAgent,
      });
    });

    it("shows outdated browser banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowUpdateBrowserBanner(userId)).toBe(true);
    });

    it("dismisses outdated browser banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowUpdateBrowserBanner(userId)).toBe(true);

      await service.dismissBanner(userId, VisibleVaultBanner.OutdatedBrowser);

      expect(await service.shouldShowUpdateBrowserBanner(userId)).toBe(false);
    });
  });

  describe("VerifyEmail", () => {
    beforeEach(async () => {
      accounts$.next({
        [userId]: {
          ...accounts$.value[userId],
          emailVerified: false,
        },
      });
    });

    it("shows verify email banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowVerifyEmailBanner(userId)).toBe(true);
    });

    it("dismisses verify email banner", async () => {
      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowVerifyEmailBanner(userId)).toBe(true);

      await service.dismissBanner(userId, VisibleVaultBanner.VerifyEmail);

      expect(await service.shouldShowVerifyEmailBanner(userId)).toBe(false);
    });

    // Keykeeper: the banner follows the account, so it goes away when a sync
    // learns the address was verified, even with the vault already open.
    describe("as it changes", () => {
      let laterUserId: UserId;

      beforeEach(() => {
        // Its own account each time: what one test dismisses stays dismissed.
        laterUserId = Utils.newGuid() as UserId;
        accounts$.next({
          ...accounts$.value,
          [laterUserId]: mockAccountInfoWith({ email: "later@example.test", name: "later" }),
        });
        accounts$.next({
          ...accounts$.value,
          [laterUserId]: { ...accounts$.value[laterUserId], emailVerified: false },
        });
      });

      it("turns false as soon as the email is verified", () => {
        service = TestBed.inject(VaultBannersService);
        const seen: boolean[] = [];
        const subscription = service
          .shouldShowVerifyEmailBanner$(laterUserId)
          .subscribe((show) => seen.push(show));

        expect(seen).toEqual([true]);

        // A sync sets the account's emailVerified from the server's profile.
        accounts$.next({
          ...accounts$.value,
          [laterUserId]: { ...accounts$.value[laterUserId], emailVerified: true },
        });

        expect(seen).toEqual([true, false]);
        subscription.unsubscribe();
      });

      it("doesn't repeat itself when something else about the accounts changes", () => {
        service = TestBed.inject(VaultBannersService);
        const seen: boolean[] = [];
        const subscription = service
          .shouldShowVerifyEmailBanner$(laterUserId)
          .subscribe((show) => seen.push(show));

        accounts$.next({
          ...accounts$.value,
          [laterUserId]: { ...accounts$.value[laterUserId], name: "renamed" },
        });

        expect(seen).toEqual([true]);
        subscription.unsubscribe();
      });

      it("turns false when the banner is dismissed", async () => {
        service = TestBed.inject(VaultBannersService);
        const seen: boolean[] = [];
        const subscription = service
          .shouldShowVerifyEmailBanner$(laterUserId)
          .subscribe((show) => seen.push(show));

        await service.dismissBanner(laterUserId, VisibleVaultBanner.VerifyEmail);

        expect(seen).toEqual([true, false]);
        subscription.unsubscribe();
      });
    });
  });

  describe("PendingAuthRequest", () => {
    const now = new Date();
    let authRequestResponse: AuthRequestResponse;

    beforeEach(() => {
      authRequestResponse = new AuthRequestResponse({
        id: "authRequest1",
        deviceId: "device1",
        deviceName: "Test Device",
        deviceType: DeviceType.Android,
        creationDate: now.toISOString(),
        requestApproved: null,
      });
      // Reset devices list, single user state, and active user state before each test
      pendingAuthRequests$.next([]);
      fakeStateProvider.singleUser.states.clear();
      fakeStateProvider.activeUser.states.clear();
    });

    it("shows pending auth request banner when there is a pending request", async () => {
      pendingAuthRequests$.next([new AuthRequestResponse(authRequestResponse)]);

      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowPendingAuthRequestBanner(userId)).toBe(true);
    });

    it("does not show pending auth request banner when there are no pending requests", async () => {
      pendingAuthRequests$.next([]);

      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowPendingAuthRequestBanner(userId)).toBe(false);
    });

    it("dismisses pending auth request banner", async () => {
      pendingAuthRequests$.next([new AuthRequestResponse(authRequestResponse)]);

      service = TestBed.inject(VaultBannersService);

      expect(await service.shouldShowPendingAuthRequestBanner(userId)).toBe(true);

      await service.dismissBanner(userId, VisibleVaultBanner.PendingAuthRequest);

      expect(await service.shouldShowPendingAuthRequestBanner(userId)).toBe(false);
    });
  });
});
