// Keykeeper: where the Plan page is, and who has it (DESIGN.md, "Plans and
// billing", "Upstream's billing pages go" and "Who sees the button"). It
// stands where upstream's Subscription page (a person's) and Billing page (an
// organization's owners') were; an MSP's admins have its pool in the MSP
// console. Where plans aren't enforced there's no Plan page and no menu entry,
// and its address opens the vault, as any address the web vault doesn't have.
import { inject } from "@angular/core";
import { ActivatedRouteSnapshot, CanActivateFn, Router } from "@angular/router";
import { firstValueFrom, switchMap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { ownPlan$ } from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import { organizationPlanPage } from "@bitwarden/common/billing/keykeeper/plan-banners";
import { getById } from "@bitwarden/common/platform/misc";
import { SyncService } from "@bitwarden/common/platform/sync";
import { StateProvider } from "@bitwarden/state";

/** Whether someone has an organization's Plan page. */
export function hasOrganizationPlanPage(organization: Organization): boolean {
  return organizationPlanPage(organization.keykeeperPlan, organization.isOwner);
}

async function syncedOnce(syncService: SyncService) {
  if ((await syncService.getLastSync()) == null) {
    await syncService.fullSync(false);
  }
}

/** A person's Plan page, where plans are enforced. */
export const keykeeperPersonalPlanGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const accountService = inject(AccountService);
  const stateProvider = inject(StateProvider);
  await syncedOnce(inject(SyncService));
  const plan = await firstValueFrom(
    accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => ownPlan$(stateProvider, userId)),
    ),
  );
  return plan.enforced ? true : router.createUrlTree(["/"]);
};

/** An organization's Plan page, for whoever has it. */
export const keykeeperOrganizationPlanGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
) => {
  const router = inject(Router);
  const accountService = inject(AccountService);
  const organizationService = inject(OrganizationService);
  await syncedOnce(inject(SyncService));
  const organization = await firstValueFrom(
    accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => organizationService.organizations$(userId)),
      getById(route.params.organizationId),
    ),
  );
  return organization != null && hasOrganizationPlanPage(organization)
    ? true
    : router.createUrlTree(["/"]);
};
