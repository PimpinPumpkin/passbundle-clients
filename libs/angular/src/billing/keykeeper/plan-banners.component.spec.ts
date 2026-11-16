import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { BehaviorSubject, firstValueFrom, of } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import {
  KEYKEEPER_OWN_PLAN,
  KEYKEEPER_PLAN_NOT_ENFORCED,
  KeykeeperPlan,
  KeykeeperPlanEnforced,
} from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import {
  KEYKEEPER_PLAN_BANNERS_PUT_AWAY,
  localDay,
} from "@bitwarden/common/billing/keykeeper/plan-banners";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { StateProvider } from "@bitwarden/state";

import { KeykeeperPlanBannersComponent } from "./plan-banners.component";

const USER = "user-1" as UserId;
const DAY = 86_400_000;
/** Noon UTC some days from now, so the day is the same in any time zone the tests run in. */
const daysFromNow = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
};
const inWords = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(iso));

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

function org(id: string, name: string, p: KeykeeperPlan, role: "owner" | "admin" | "user") {
  return {
    id,
    name,
    isMember: true,
    isOwner: role === "owner",
    isAdmin: role !== "user",
    keykeeperPlan: p,
  } as unknown as Organization;
}

describe("KeykeeperPlanBannersComponent", () => {
  let fixture: ComponentFixture<KeykeeperPlanBannersComponent>;
  let stateProvider: FakeStateProvider;
  let organizations$: BehaviorSubject<Organization[]>;

  async function render(own: KeykeeperPlan, orgs: Organization[], inExtension = false) {
    const accountService = mockAccountServiceWith(USER);
    stateProvider = new FakeStateProvider(accountService);
    await stateProvider.setUserState(KEYKEEPER_OWN_PLAN, own, USER);
    organizations$ = new BehaviorSubject(orgs);
    await TestBed.configureTestingModule({
      imports: [KeykeeperPlanBannersComponent],
      providers: [
        { provide: AccountService, useValue: accountService },
        { provide: StateProvider, useValue: stateProvider },
        { provide: OrganizationService, useValue: { organizations$: () => organizations$ } },
        {
          provide: EnvironmentService,
          useValue: {
            environment$: of({ getWebVaultUrl: () => "https://vault.example.test" }),
          },
        },
        {
          provide: I18nService,
          useValue: {
            // Ours from brand/messages.en.json; upstream's ("close") as their keys.
            t: (key: string, ...values: string[]) =>
              key.startsWith("keykeeper") ? translate(key, ...values) : key,
            translationLocale: "en-US",
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperPlanBannersComponent);
    fixture.componentRef.setInput("inExtension", inExtension);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const banners = () =>
    fixture.debugElement.queryAll(By.css('[data-testid="keykeeper-plan-banner"]'));
  const linkOf = (banner: ReturnType<typeof banners>[number]) =>
    banner.query(By.css('[data-testid="keykeeper-plan-banner-link"]'))?.nativeElement as
      HTMLAnchorElement | undefined;

  it("shows nothing where plans aren't enforced", async () => {
    await render(KEYKEEPER_PLAN_NOT_ENFORCED, [
      org("org-1", "Acme Dental", KEYKEEPER_PLAN_NOT_ENFORCED, "owner"),
    ]);
    expect(banners()).toHaveLength(0);
  });

  it("tells an owner and an admin that an organization's plan has ended, and links the owner to its Plan page", async () => {
    const ended = plan({ state: "ended", storageGb: 0 });
    await render(plan({ plan: "free", state: null, storageGb: 0 }), [
      org("org-1", "Acme Dental", ended, "owner"),
      org("org-2", "Baker Law", { ...ended, canManage: false }, "admin"),
      org("org-3", "Cedar Clinic", { ...ended, canManage: false }, "user"),
    ]);

    const [acme, baker] = banners();
    expect(banners()).toHaveLength(2);
    expect(acme.nativeElement.getAttribute("data-kind")).toBe("ended");
    expect(acme.nativeElement.textContent).toContain(
      "The plan for Acme Dental has ended, so nothing new can be added to it. Everything in it can still be opened, changed, exported, and deleted.",
    );
    expect(linkOf(acme)?.getAttribute("href")).toBe("#/organizations/org-1/plan");
    expect(linkOf(acme)?.textContent?.trim()).toBe("See plan");
    expect(linkOf(acme)?.getAttribute("target")).toBeNull();
    expect(baker.nativeElement.getAttribute("data-whose")).toBe("organization:org-2");
    expect(linkOf(baker)).toBeUndefined();
  });

  it("tells whoever pays that a payment is due, in plain words with the dates in words", async () => {
    const until = daysFromNow(-3);
    await render(
      plan({ plan: "premium", state: "paymentDue", until, renews: true, storageGb: 5 }),
      [],
    );

    const [due] = banners();
    expect(due.nativeElement.getAttribute("data-kind")).toBe("paymentDue");
    expect(due.nativeElement.textContent).toContain(
      `A payment for your Premium is due. It was paid through ${inWords(until)}.`,
    );
    expect(linkOf(due)?.getAttribute("href")).toBe("#/settings/plan");
  });

  it("in the extension, links to the web vault's Plan page in a new tab", async () => {
    const freeUntil = daysFromNow(5);
    await render(
      plan({ plan: "free", state: null }),
      [org("org-1", "Acme Dental", plan({ state: "trial", freeUntil, freeWhy: "trial" }), "owner")],
      true,
    );

    const [trial] = banners();
    expect(trial.nativeElement.textContent).toContain(
      `The trial for Acme Dental ends on ${inWords(freeUntil)}.`,
    );
    const link = linkOf(trial)!;
    expect(link.getAttribute("href")).toBe("https://vault.example.test/#/organizations/org-1/plan");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("puts a banner away for the rest of the day", async () => {
    await render(plan({ plan: "free", state: null }), [
      org("org-1", "Acme Dental", plan({ state: "ended" }), "owner"),
    ]);
    expect(banners()).toHaveLength(1);

    banners()[0].query(By.css('[data-testid="bit-banner-close-btn"]')).nativeElement.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(banners()).toHaveLength(0);
    const putAway = await firstValueFrom(
      stateProvider.getUser(USER, KEYKEEPER_PLAN_BANNERS_PUT_AWAY).state$,
    );
    expect(putAway).toEqual({ "ended:organization:org-1": localDay(new Date()) });
  });

  it("shows a banner put away on another day", async () => {
    await render(plan({ plan: "free", state: null }), [
      org("org-1", "Acme Dental", plan({ state: "ended" }), "owner"),
    ]);
    await stateProvider.setUserState(
      KEYKEEPER_PLAN_BANNERS_PUT_AWAY,
      { "ended:organization:org-1": "2020-01-01" },
      USER,
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(banners()).toHaveLength(1);
  });
});
