import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { mock, MockProxy } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import {
  KEYKEEPER_OWN_PLAN,
  KEYKEEPER_PLAN_NOT_ENFORCED,
  KeykeeperPlan,
} from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import { KEYKEEPER_PLAN_BANNERS_PUT_AWAY } from "@bitwarden/common/billing/keykeeper/plan-banners";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { ToastService } from "@bitwarden/components";
import { StateProvider } from "@bitwarden/state";

import { KeykeeperMspPlanComponent } from "./msp-plan.component";

const USER = "user-1" as UserId;
const DAY = 86_400_000;
const noonInDays = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
};

const pool = (fields: Record<string, unknown>) => ({
  enforced: true,
  plan: "msp",
  state: "active",
  freeUntil: null,
  freeWhy: null,
  until: null,
  renews: true,
  storageGb: null,
  people: null,
  coveredBy: null,
  canManage: true,
  ...fields,
});

describe("KeykeeperMspPlanComponent", () => {
  let fixture: ComponentFixture<KeykeeperMspPlanComponent>;
  let api: MockProxy<ApiService>;
  let stateProvider: FakeStateProvider;

  async function render(own: KeykeeperPlan, answer: unknown) {
    const accountService = mockAccountServiceWith(USER);
    stateProvider = new FakeStateProvider(accountService);
    await stateProvider.setUserState(KEYKEEPER_OWN_PLAN, own, USER);
    api = mock<ApiService>();
    if (answer instanceof Error) {
      api.send.mockRejectedValue(answer);
    } else {
      api.send.mockResolvedValue(answer);
    }
    await TestBed.configureTestingModule({
      imports: [KeykeeperMspPlanComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AccountService, useValue: accountService },
        { provide: StateProvider, useValue: stateProvider },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
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
    fixture = TestBed.createComponent(KeykeeperMspPlanComponent);
    fixture.componentRef.setInput("mspId", "msp-1");
    fixture.componentRef.setInput("mspName", "Contoso IT");
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const section = () => fixture.debugElement.query(By.css('[data-testid="msp-plan"]'));
  const notice = () => fixture.debugElement.query(By.css('[data-testid="keykeeper-plan-banner"]'));

  it("asks nothing and shows nothing where plans aren't enforced", async () => {
    await render(KEYKEEPER_PLAN_NOT_ENFORCED, pool({}));
    expect(api.send).not.toHaveBeenCalled();
    expect(section()).toBeNull();
  });

  it("shows the pool to its admins", async () => {
    await render(pool({ plan: "free", state: null, canManage: true }), pool({}));
    expect(api.send).toHaveBeenCalledWith("GET", "/keykeeper/plan?msp=msp-1", null, true, true);
    expect(section().nativeElement.textContent).toContain("MSP seat pool");
    expect(section().nativeElement.textContent).toContain("Active");
    expect(notice()).toBeNull();
  });

  it("shows nothing to someone the server says doesn't manage the pool", async () => {
    await render(pool({ plan: "free", state: null }), new Error("Plan not found"));
    expect(section()).toBeNull();
  });

  it("says the pool's trial is ending, and can be put away for the day", async () => {
    const freeUntil = noonInDays(6);
    await render(
      pool({ plan: "free", state: null }),
      pool({ state: "trial", freeUntil, freeWhy: "trial", renews: false }),
    );
    const when = new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
      new Date(freeUntil),
    );
    expect(notice().nativeElement.textContent).toContain(
      `The trial for Contoso IT ends on ${when}. If it isn't paid for by then, nothing new can be added to your clients.`,
    );

    notice().query(By.css("button")).nativeElement.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(notice()).toBeNull();
    const putAway = await new Promise((resolve) =>
      stateProvider.getUser(USER, KEYKEEPER_PLAN_BANNERS_PUT_AWAY).state$.subscribe(resolve),
    );
    expect(Object.keys(putAway as object)).toEqual(["trialEnding:msp:msp-1"]);
  });
});
