import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { Subject, throwError } from "rxjs";

import { OrganizationUserService, PendingMember } from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { ToastService } from "@bitwarden/components";
// eslint-disable-next-line no-restricted-imports
import { LegacyCompatKeyService } from "@bitwarden/legacy-crypto";

import { KeykeeperMspApiService } from "../msp/msp-api.service";
import { KeykeeperMspWorkService } from "../msp/msp-work.service";

import { FamilyLinkView, KeykeeperFamilyLinkService } from "./family-link.service";
import { KeykeeperFamilyWaitingComponent } from "./family-waiting.component";

/** Ours from brand/messages.en.json (a key that isn't there fails), upstream's as their keys. */
const keykeeperI18n = {
  t: (key: string, ...values: string[]) =>
    key.startsWith("keykeeper") ? translate(key, ...values) : key,
  translationLocale: "en-US",
};

/** Someone waiting for the family's key, with the public key the server holds for them. */
const KID: PendingMember = {
  organizationId: "family-1",
  memberId: "member-kid",
  userId: "user-kid",
  email: "kid@smith.test",
  publicKey: "AQID",
  autoConfirm: true,
};

/** The server's answer to the slower of two confirms, as upstream's API service throws it. */
const refusal = () => new ErrorResponse({ message: "User in invalid state" }, 400);

describe("KeykeeperFamilyWaitingComponent, confirming someone waiting by hand", () => {
  let fixture: ComponentFixture<KeykeeperFamilyWaitingComponent>;
  let api: MockProxy<KeykeeperMspApiService>;
  let organizationUserService: MockProxy<OrganizationUserService>;
  let toast: MockProxy<ToastService>;
  let confirmed: number;

  const family = { id: "family-1", name: "Smith Family", isOwner: true } as Organization;

  afterEach(() => TestBed.resetTestingModule());

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The family's waiting list as its owner sees it, then Confirm, refused by the server. */
  async function confirmRefused(confirmedNow: boolean) {
    const familyLinks = mock<KeykeeperFamilyLinkService>();
    // A family: its owners and admins get its invite link.
    familyLinks.get.mockResolvedValue({} as FamilyLinkView);
    api = mock<KeykeeperMspApiService>();
    api.organizationsPending.mockResolvedValue([KID]);
    api.isConfirmed.mockResolvedValue(confirmedNow);
    const work = mock<KeykeeperMspWorkService>();
    (work as { updated$: unknown }).updated$ = new Subject<void>();
    const fingerprints = mock<LegacyCompatKeyService>();
    fingerprints.getFingerprint.mockResolvedValue(["alpha", "bravo", "charlie"]);
    organizationUserService = mock<OrganizationUserService>();
    organizationUserService.confirmUser.mockReturnValue(throwError(() => refusal()));
    toast = mock<ToastService>();
    await TestBed.configureTestingModule({
      imports: [KeykeeperFamilyWaitingComponent],
      providers: [
        provideRouter([]),
        { provide: I18nService, useValue: keykeeperI18n },
        { provide: KeykeeperFamilyLinkService, useValue: familyLinks },
        { provide: KeykeeperMspApiService, useValue: api },
        { provide: KeykeeperMspWorkService, useValue: work },
        { provide: LegacyCompatKeyService, useValue: fingerprints },
        { provide: OrganizationUserService, useValue: organizationUserService },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperFamilyWaitingComponent);
    fixture.componentRef.setInput("organization", family);
    confirmed = 0;
    fixture.componentInstance.confirmed.subscribe(() => confirmed++);
    await settle();
    expect(listed()).toEqual(["kid@smith.test"]);
    kidRow()!.querySelector<HTMLButtonElement>('[data-testid="family-waiting-confirm"]')!.click();
    await settle();
    // What's sent is upstream's confirm, to the key the phrase shown was made from.
    expect(organizationUserService.confirmUser).toHaveBeenCalledWith(
      family,
      "member-kid",
      Utils.fromB64ToArray("AQID"),
    );
  }

  const page = () => fixture.nativeElement as HTMLElement;
  const kidRow = () => page().querySelector('[data-email="kid@smith.test"]');
  const listed = () =>
    Array.from(page().querySelectorAll("[data-email]")).map((e) => e.getAttribute("data-email"));
  const toasts = () => toast.showToast.mock.calls.map((c) => c[0]);

  it("says the person is already in the family, with no error, when another device confirmed them a moment before", async () => {
    await confirmRefused(true);
    expect(toasts()).toEqual([
      { variant: "info", message: "kid@smith.test is already in Smith Family." },
    ]);
    // No longer waiting, and the member list reads again.
    expect(listed()).toEqual([]);
    expect(confirmed).toBe(1);
    expect(api.isConfirmed).toHaveBeenCalledWith("family-1", "member-kid");
  });

  it("still shows the server's refusal, and keeps them waiting, when a fresh read shows them not confirmed", async () => {
    await confirmRefused(false);
    expect(toasts()).toEqual([{ variant: "error", message: plainErrorMessage(refusal()) }]);
    expect(listed()).toEqual(["kid@smith.test"]);
    expect(confirmed).toBe(0);
    // It asked, and the answer wasn't "confirmed": the refusal alone settles nothing.
    expect(api.isConfirmed).toHaveBeenCalledWith("family-1", "member-kid");
  });
});
