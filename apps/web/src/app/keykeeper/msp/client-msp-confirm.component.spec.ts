import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { throwError } from "rxjs";

import { ClientMspStaff, OrganizationUserService } from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { ToastService } from "@bitwarden/components";

import { KeykeeperClientMspConfirmComponent } from "./client-msp-confirm.component";
import { KeykeeperMspApiService } from "./msp-api.service";

/** Ours from brand/messages.en.json (a key that isn't there fails), upstream's as their keys. */
const keykeeperI18n = {
  t: (key: string, ...values: string[]) =>
    key.startsWith("keykeeper") ? translate(key, ...values) : key,
  translationLocale: "en-US",
};

/** One of the MSP's people, waiting for the organization's key, with the public key the server holds for them. */
const DANA: ClientMspStaff = {
  memberId: "member-dana",
  userId: "user-dana",
  publicKey: "AQID",
  email: "dana@northwind.test",
  name: "Dana",
  type: 0,
  status: 1,
};

/** The server's answer to the slower of two confirms, as upstream's API service throws it. */
const refusal = () => new ErrorResponse({ message: "User in invalid state" }, 400);

describe("KeykeeperClientMspConfirmComponent, confirming one of the MSP's people by hand", () => {
  let fixture: ComponentFixture<KeykeeperClientMspConfirmComponent>;
  let mspApi: MockProxy<KeykeeperMspApiService>;
  let organizationUserService: MockProxy<OrganizationUserService>;
  let toast: MockProxy<ToastService>;
  let confirmed: number;

  const organization = { id: "org-1", name: "Acme Dental", isOwner: true } as Organization;

  afterEach(() => TestBed.resetTestingModule());

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The waiting list as the client's owner sees it, then Confirm on Dana, refused by the server. */
  async function confirmRefused(confirmedNow: boolean) {
    mspApi = mock<KeykeeperMspApiService>();
    mspApi.staffPhrases.mockResolvedValue(new Map([["user-dana", "alpha-bravo-charlie"]]));
    mspApi.isConfirmed.mockResolvedValue(confirmedNow);
    organizationUserService = mock<OrganizationUserService>();
    organizationUserService.confirmUser.mockReturnValue(throwError(() => refusal()));
    toast = mock<ToastService>();
    await TestBed.configureTestingModule({
      imports: [KeykeeperClientMspConfirmComponent],
      providers: [
        { provide: I18nService, useValue: keykeeperI18n },
        { provide: KeykeeperMspApiService, useValue: mspApi },
        { provide: OrganizationUserService, useValue: organizationUserService },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperClientMspConfirmComponent);
    fixture.componentRef.setInput("organization", organization);
    fixture.componentRef.setInput("staff", [DANA]);
    confirmed = 0;
    fixture.componentInstance.confirmed.subscribe(() => confirmed++);
    await settle();
    const button = page().querySelector<HTMLButtonElement>(
      'button[aria-label="Confirm dana@northwind.test"]',
    )!;
    button.click();
    await settle();
    // What's sent is upstream's confirm, to the key the phrase shown was made from.
    expect(organizationUserService.confirmUser).toHaveBeenCalledWith(
      organization,
      "member-dana",
      Utils.fromB64ToArray("AQID"),
    );
  }

  const page = () => fixture.nativeElement as HTMLElement;
  const toasts = () => toast.showToast.mock.calls.map((c) => c[0]);

  it("says the person is already in, with no error, when another device confirmed them a moment before", async () => {
    await confirmRefused(true);
    expect(toasts()).toEqual([
      { variant: "info", message: "Dana (dana@northwind.test) is already in Acme Dental." },
    ]);
    // The member list reads again, and shows them confirmed.
    expect(confirmed).toBe(1);
    expect(mspApi.isConfirmed).toHaveBeenCalledWith("org-1", "member-dana");
  });

  it("still shows the server's refusal when a fresh read shows them not confirmed", async () => {
    await confirmRefused(false);
    expect(toasts()).toEqual([{ variant: "error", message: plainErrorMessage(refusal()) }]);
    expect(confirmed).toBe(0);
    // It asked, and the answer wasn't "confirmed": the refusal alone settles nothing.
    expect(mspApi.isConfirmed).toHaveBeenCalledWith("org-1", "member-dana");
  });
});
