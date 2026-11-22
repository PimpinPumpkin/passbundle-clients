import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";

import { MspDetails } from "@bitwarden/admin-console/common";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { KeykeeperMspApiService } from "./msp-api.service";
import { KeykeeperMspLinkCodesComponent } from "./msp-link-codes.component";

/** Ours from brand/messages.en.json (a key that isn't there fails), upstream's as their keys. */
const keykeeperI18n = {
  t: (key: string, ...values: string[]) =>
    key.startsWith("keykeeper") ? translate(key, ...values) : key,
  translationLocale: "en-US",
};

describe("KeykeeperMspLinkCodesComponent, what an MSP admin reads about bringing in an organization", () => {
  let fixture: ComponentFixture<KeykeeperMspLinkCodesComponent>;
  let mspApi: MockProxy<KeykeeperMspApiService>;

  afterEach(() => TestBed.resetTestingModule());

  it("says its owner confirms one of your admins after comparing phrases, and the rest of your staff get in without that", async () => {
    mspApi = mock<KeykeeperMspApiService>();
    mspApi.linkCodes.mockResolvedValue([]);
    await TestBed.configureTestingModule({
      imports: [KeykeeperMspLinkCodesComponent],
      providers: [
        { provide: I18nService, useValue: keykeeperI18n },
        { provide: KeykeeperMspApiService, useValue: mspApi },
        { provide: DialogService, useValue: mock<DialogService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperMspLinkCodesComponent);
    fixture.componentRef.setInput("msp", {
      id: "msp-1",
      name: "Northwind IT",
      role: "admin",
      clients: [],
      staff: [],
    } as unknown as MspDetails);
    fixture.detectChanges();
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    const then = page.querySelector('[data-testid="msp-link-codes-then"]')!;
    expect(then.textContent!.replace(/\s+/g, " ").trim()).toBe(
      "Its owner then confirms one of your admins there, after comparing fingerprint phrases. That admin uses Confirm client on its row, and the rest of your staff get in as in any client, without its owner comparing each one. It keeps its own plan, so it isn't counted in your seats.",
    );
    expect(page.textContent).not.toContain("Your staff then wait for its owner to confirm them");
  });
});
