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
    await render(plan({ plan: "families", state: "ended", people: 6, canPay: true }));
    api.send.mockResolvedValue({ url: "https://pay.example.test/session/1" });

    expect(button().nativeElement.textContent.trim()).toBe("Set up payment");
    button().nativeElement.click();
    await fixture.whenStable();

    expect(api.send).toHaveBeenCalledWith(
      "POST",
      "/keykeeper/plan/pay",
      { organization: "org-1", plan: "families" },
      true,
      true,
    );
    expect(platformUtils.launchUri).toHaveBeenCalledWith("https://pay.example.test/session/1");
  });

  it("adds a card for a Business organization billed by the day", async () => {
    await render(plan({ state: "trial", freeUntil: DEC_15, freeWhy: "trial", canPay: true }));
    api.send.mockResolvedValue({ url: "https://pay.example.test/session/1" });

    expect(button().nativeElement.textContent.trim()).toBe("Add a card");
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

  describe("the invoices of a plan billed by the day", () => {
    const pool: PlanWhose = { kind: "msp", id: "msp-1", name: "Contoso IT" };
    const invoices = {
      invoices: [
        {
          month: "2026-11",
          seatDays: 311,
          freeDays: 0,
          daysInMonth: 30,
          prorated: 10.37,
          priceCents: 150,
          amountCents: 1556,
          currency: "usd",
          state: "invoiced",
          sentAt: "2026-12-01T00:35:00.000000Z",
        },
        {
          month: "2026-10",
          seatDays: 120,
          freeDays: 9,
          daysInMonth: 31,
          prorated: 3.87,
          priceCents: 150,
          amountCents: 581,
          currency: "usd",
          state: "pending",
          sentAt: null,
        },
      ],
    };
    const rows = () =>
      fixture.debugElement
        .queryAll(By.css('[data-testid="keykeeper-plan-invoice"]'))
        .map((row) =>
          row
            .queryAll(By.css("td"))
            .map((cell) =>
              (cell.nativeElement as HTMLElement).textContent?.replace(/\s+/g, " ").trim(),
            ),
        );

    async function renderWith(answer: unknown, p: KeykeeperPlanEnforced, whose: PlanWhose) {
      await TestBed.resetTestingModule();
      api = mock<ApiService>();
      api.send.mockResolvedValue(answer);
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
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it("lists the pool's months for its admins: seat-days, prorated seats, the price, the amount, and its state", async () => {
      await renderWith(invoices, plan({ plan: "msp", storageGb: null, canPay: true }), pool);

      expect(api.send).toHaveBeenCalledWith(
        "GET",
        "/keykeeper/plan/invoices?msp=msp-1",
        null,
        true,
        true,
      );
      expect(text("keykeeper-plan-invoices").length).toBe(1);
      expect(fixture.nativeElement.textContent).toContain(
        "Billed after each month to the card on file: the month's seat-days (its seats each day, added up) divided by its days, times the price a seat.",
      );
      expect(rows()).toEqual([
        ["November 2026", "311", "10.37", "$1.50", "$15.56", "Invoiced"],
        ["October 2026", "120 (9 of 31 days free)", "3.87", "$1.50", "$5.81", "Being invoiced"],
      ]);
      // With a card on file, the button manages it.
      expect(button().nativeElement.textContent.trim()).toBe("Manage payment");
    });

    it("says there are none yet, and offers to add a card", async () => {
      await renderWith(
        { invoices: [] },
        plan({ state: "trial", freeUntil: DEC_15, freeWhy: "trial", canPay: true }),
        acme,
      );
      expect(api.send).toHaveBeenCalledWith(
        "GET",
        "/keykeeper/plan/invoices?organization=org-1",
        null,
        true,
        true,
      );
      expect(text("keykeeper-plan-invoices-none")).toEqual(["No invoices yet."]);
      expect(rows()).toEqual([]);
      expect(button().nativeElement.textContent.trim()).toBe("Add a card");
    });

    it("isn't asked for where the person can't pay, for a client of an MSP, or for a plan paid a year ahead", async () => {
      for (const [p, whose] of [
        [plan({ plan: "msp", storageGb: null, canPay: false }), pool],
        [plan({ coveredBy: { id: "msp-1", name: "Contoso IT" }, canPay: true }), acme],
        [plan({ plan: "families", people: 6, canPay: true }), acme],
        [plan({ plan: "premium", canPay: true }), { kind: "person" }],
      ] as [KeykeeperPlanEnforced, PlanWhose][]) {
        await renderWith(invoices, p, whose);
        expect(api.send).not.toHaveBeenCalled();
        expect(text("keykeeper-plan-invoices")).toEqual([]);
      }
    });
  });
});
