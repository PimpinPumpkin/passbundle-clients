import { TestBed } from "@angular/core/testing";
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from "@angular/router";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import {
  KEYKEEPER_OWN_PLAN,
  KEYKEEPER_PLAN_NOT_ENFORCED,
  KeykeeperPlan,
  KeykeeperPlanEnforced,
} from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import { SyncService } from "@bitwarden/common/platform/sync";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { StateProvider } from "@bitwarden/state";

import {
  hasOrganizationPlanPage,
  keykeeperOrganizationPlanGuard,
  keykeeperPersonalPlanGuard,
} from "./plan-pages";

const USER = "user-1" as UserId;
const toVault = { toString: () => "/" } as UrlTree;

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
    canManage: false,
    canPay: false,
    ...fields,
  };
}

const org = (keykeeperPlan: KeykeeperPlan, isOwner: boolean) =>
  ({ id: "org-1", name: "Acme Dental", keykeeperPlan, isOwner }) as unknown as Organization;

async function guard(
  own: KeykeeperPlan,
  organizations: Organization[],
  which: "personal" | "organization",
) {
  const accountService = mockAccountServiceWith(USER);
  const stateProvider = new FakeStateProvider(accountService);
  await stateProvider.setUserState(KEYKEEPER_OWN_PLAN, own, USER);
  const syncService = mock<SyncService>();
  syncService.getLastSync.mockResolvedValue(new Date());
  const router = mock<Router>();
  router.createUrlTree.mockReturnValue(toVault);
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountService, useValue: accountService },
      { provide: StateProvider, useValue: stateProvider },
      { provide: SyncService, useValue: syncService },
      { provide: Router, useValue: router },
      { provide: OrganizationService, useValue: { organizations$: () => of(organizations) } },
    ],
  });
  const route = { params: { organizationId: "org-1" } } as unknown as ActivatedRouteSnapshot;
  const result = await TestBed.runInInjectionContext(() =>
    (which === "personal" ? keykeeperPersonalPlanGuard : keykeeperOrganizationPlanGuard)(
      route,
      {} as RouterStateSnapshot,
    ),
  );
  return { result, router };
}

describe("the Plan pages", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("a person's opens where plans are enforced", async () => {
    const { result } = await guard(plan({ plan: "free", state: null }), [], "personal");
    expect(result).toBe(true);
  });

  it("a person's sends them to the vault where plans aren't enforced, as an address it doesn't have", async () => {
    const { result, router } = await guard(KEYKEEPER_PLAN_NOT_ENFORCED, [], "personal");
    expect(result).toBe(toVault);
    expect(router.createUrlTree).toHaveBeenCalledWith(["/"]);
  });

  it("an organization's opens for its owners", async () => {
    const { result } = await guard(
      KEYKEEPER_PLAN_NOT_ENFORCED,
      [org(plan({}), true)],
      "organization",
    );
    expect(result).toBe(true);
  });

  it("an organization's opens for whoever manages its plan: an MSP's admin in a client", async () => {
    const client = plan({ coveredBy: { id: "msp-1", name: "Contoso IT" }, canManage: true });
    const { result } = await guard(
      KEYKEEPER_PLAN_NOT_ENFORCED,
      [org(client, false)],
      "organization",
    );
    expect(result).toBe(true);
  });

  it("an organization's sends anyone else to the vault", async () => {
    const { result } = await guard(
      KEYKEEPER_PLAN_NOT_ENFORCED,
      [org(plan({}), false)],
      "organization",
    );
    expect(result).toBe(toVault);
  });

  it("an organization's sends everyone to the vault where plans aren't enforced", async () => {
    const { result } = await guard(
      KEYKEEPER_PLAN_NOT_ENFORCED,
      [org(KEYKEEPER_PLAN_NOT_ENFORCED, true)],
      "organization",
    );
    expect(result).toBe(toVault);
    expect(hasOrganizationPlanPage(org(KEYKEEPER_PLAN_NOT_ENFORCED, true))).toBe(false);
  });

  it("an organization's sends someone who isn't in it to the vault", async () => {
    const { result } = await guard(KEYKEEPER_PLAN_NOT_ENFORCED, [], "organization");
    expect(result).toBe(toVault);
  });
});
