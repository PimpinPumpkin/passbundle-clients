import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { mock, MockProxy } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { KeykeeperPlanEnforced } from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { PlanWhose } from "@bitwarden/common/billing/keykeeper/plan-words";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { ToastService } from "@bitwarden/components";

import { KeykeeperPlanViewComponent } from "./plan-view.component";

/** Noon UTC, so the date is the same in any time zone the tests run in. */
const DEC_15 = "2026-12-15T12:00:00.000000Z";

function plan(fields: Partial<KeykeeperPlanEnforced>): KeykeeperPlanEnforced {
  return {
    enforced: true,
    plan: "business",
    state: "active",
    freeUntil: null,
    freeWhy: null,
    until: null,
    renews: null,
    endsAt: null,
    storageGb: 12,
    people: null,
    coveredBy: null,
    canManage: true,
    canPay: false,
    ...fields,
  };
}

const acme: PlanWhose = { kind: "organization", id: "org-1", name: "Acme Dental" };

describe("KeykeeperPlanViewComponent", () => {
  let fixture: ComponentFixture<KeykeeperPlanViewComponent>;
  let api: MockProxy<ApiService>;
  let platformUtils: MockProxy<PlatformUtilsService>;
  let toastService: MockProxy<ToastService>;

  async function render(p: KeykeeperPlanEnforced, whose: PlanWhose = acme) {
    api = mock<ApiService>();
    platformUtils = mock<PlatformUtilsService>();
    toastService = mock<ToastService>();
    await TestBed.configureTestingModule({
      imports: [KeykeeperPlanViewComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: PlatformUtilsService, useValue: platformUtils },
        { provide: ToastService, useValue: toastService },
        {
          provide: I18nService,
          useValue: {
            t: (key: string, ...values: string[]) =>
              key.startsWith("keykeeper") ? translate(key, ...values) : key,
            translationLocale: "en-US",
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperPlanViewComponent);
    fixture.componentRef.setInput("plan", p);
    fixture.componentRef.setInput("whose", whose);
    fixture.detectChanges();
  }

  const text = (testId: string) =>
    fixture.debugElement
      .queryAll(By.css(`[data-testid="${testId}"]`))
      .map((e) => (e.nativeElement as HTMLElement).textContent?.trim());
  const button = () => fixture.debugElement.query(By.css('[data-testid="keykeeper-plan-button"]'));

  it("says the plan, its dates, and what it gives", async () => {
    await render(plan({ state: "trial", freeUntil: DEC_15, freeWhy: "trial" }));

    expect(text("keykeeper-plan-name")).toEqual(["Business"]);
    expect(text("keykeeper-plan-status")).toEqual(["Trial until December 15, 2026"]);
    expect(text("keykeeper-plan-covered-by")).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain("Includes");
    expect(fixture.nativeElement.textContent).toContain("12 GB for attachments in shared folders");
    expect(fixture.nativeElement.textContent).toContain("Any number of people");
  });

  it("has no button while the server doesn't say the person can pay", async () => {
    await render(plan({ state: "trial", freeUntil: DEC_15, freeWhy: "trial" }));
    expect(button()).toBeNull();
  });

  it("says who covers a client of an MSP, with no button", async () => {
    await render(
      plan({ plan: "msp", coveredBy: { id: "msp-1", name: "Contoso IT" }, canPay: true }),
    );
    expect(text("keykeeper-plan-covered-by")).toEqual(["Covered by Contoso IT"]);
    expect(button()).toBeNull();
  });

  it("opens the provider's page to pay, for whoever can pay", async () => {
    await render(plan({ state: "trial", freeUntil: DEC_15, freeWhy: "trial", canPay: true }));
    api.send.mockResolvedValue({ url: "https://pay.example.test/session/1" });

    expect(button().nativeElement.textContent.trim()).toBe("Set up payment");
    button().nativeElement.click();
    await fixture.whenStable();

    expect(api.send).toHaveBeenCalledWith(
      "POST",
      "/keykeeper/plan/pay",
      { organization: "org-1", plan: "business" },
      true,
      true,
    );
    expect(platformUtils.launchUri).toHaveBeenCalledWith("https://pay.example.test/session/1");
  });

  it("opens the provider's page to manage a person's own plan in good standing", async () => {
    await render(plan({ plan: "premium", until: DEC_15, renews: true, canPay: true }), {
      kind: "person",
    });
    api.send.mockResolvedValue({ url: "https://pay.example.test/portal/1" });

    expect(button().nativeElement.textContent.trim()).toBe("Manage payment");
    button().nativeElement.click();
    await fixture.whenStable();

    expect(api.send).toHaveBeenCalledWith("POST", "/keykeeper/plan/manage", {}, true, true);
    expect(platformUtils.launchUri).toHaveBeenCalledWith("https://pay.example.test/portal/1");
  });

  it("opens nothing but an https page, and says so", async () => {
    await render(plan({ state: "ended", canPay: true }));
    api.send.mockResolvedValue({ url: "javascript:alert(1)" });

    button().nativeElement.click();
    await fixture.whenStable();

    expect(platformUtils.launchUri).not.toHaveBeenCalled();
    expect(toastService.showToast).toHaveBeenCalledWith({
      variant: "error",
      message: "The server didn't send a payment page to open.",
    });
  });
});
