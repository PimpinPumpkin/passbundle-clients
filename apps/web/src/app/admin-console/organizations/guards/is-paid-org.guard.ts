import { inject } from "@angular/core";
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
} from "@angular/router";
import { firstValueFrom, switchMap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { getById } from "@bitwarden/common/platform/misc";
import { DialogService } from "@bitwarden/components";

/**
 * `CanActivateFn` that checks if the organization matching the id in the URL
 * parameters is paid or free. If the organization is free instructions are
 * provided on how to upgrade a free organization, and the user is redirected
 * if they have access to upgrade the organization. If the organization is
 * paid routing proceeds."
 */
export function isPaidOrgGuard(): CanActivateFn {
  return async (route: ActivatedRouteSnapshot, _state: RouterStateSnapshot) => {
    const router = inject(Router);
    const organizationService = inject(OrganizationService);
    const accountService = inject(AccountService);
    const dialogService = inject(DialogService);

    const org = await firstValueFrom(
      accountService.activeAccount$.pipe(
        getUserId,
        switchMap((userId) => organizationService.organizations$(userId)),
        getById(route.params.organizationId),
      ),
    );

    if (org == null) {
      return router.createUrlTree(["/"]);
    }

    if (org.isFreeOrg) {
      // Keykeeper: the organization's Billing pages are gone (DESIGN.md,
      // "Plans and billing"), so everyone gets the version without the
      // upgrade button.
      await dialogService.openSimpleDialog({
        title: { key: "upgradeOrganizationCloseSecurityGaps" },
        content: { key: "upgradeOrganizationCloseSecurityGapsDesc" },
        acceptButtonText: { key: "ok" },
        cancelButtonText: null,
        type: "info",
      });
      return false;
    }

    return !org.isFreeOrg;
  };
}
