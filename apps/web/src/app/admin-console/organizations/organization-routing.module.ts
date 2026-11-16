import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";

import { authGuard } from "@bitwarden/angular/auth/guards";
import {
  canAccessOrgAdmin,
  canAccessGroupsTab,
  canAccessMembersTab,
  canAccessVaultTab,
  canAccessReportingTab,
  canAccessSettingsTab,
} from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";

import { deepLinkGuard } from "../../auth/guards/deep-link/deep-link.guard";
import { canReviewAccess } from "../../keykeeper/access/access-review";

import { VaultModule } from "./collections/vault.module";
import { organizationPermissionsGuard } from "./guards/org-permissions.guard";
import { organizationRedirectGuard } from "./guards/org-redirect.guard";
import { OrganizationLayoutComponent } from "./layouts/organization-layout.component";
import { GroupsComponent } from "./manage/groups.component";

const routes: Routes = [
  {
    path: ":organizationId",
    component: OrganizationLayoutComponent,
    canActivate: [deepLinkGuard(), authGuard, organizationPermissionsGuard(canAccessOrgAdmin)],
    children: [
      {
        path: "",
        pathMatch: "full",
        canActivate: [organizationRedirectGuard(getOrganizationRoute)],
        children: [], // This is required to make the auto redirect work, },
      },
      {
        path: "vault",
        loadChildren: () => VaultModule,
      },
      {
        path: "settings",
        loadChildren: () =>
          import("./settings/organization-settings.module").then(
            (m) => m.OrganizationSettingsModule,
          ),
      },
      {
        path: "members",
        loadChildren: () => import("./members").then((m) => m.membersRoutes),
      },
      // Keykeeper: who can see what (DESIGN.md, "Access and offboarding").
      {
        path: "access",
        loadComponent: () =>
          import("../../keykeeper/access/access.component").then((m) => m.KeykeeperAccessComponent),
        canActivate: [organizationPermissionsGuard(canReviewAccess)],
        data: {
          titleId: "keykeeperAccess",
        },
      },
      {
        component: GroupsComponent,
        path: "groups",
        canActivate: [organizationPermissionsGuard(canAccessGroupsTab)],
        data: {
          titleId: "groups",
        },
      },
      {
        path: "reporting",
        loadChildren: () =>
          import("../organizations/reporting/organization-reporting.routes").then(
            (m) => m.organizationReportingRoutes,
          ),
      },
      // Keykeeper: upstream's organization Billing pages are gone. They
      // called a billing API this server never had (DESIGN.md, "Plans and
      // billing"). An old link to any of them lands on the vault.
      { path: "billing", redirectTo: "/" },
    ],
  },
];

function getOrganizationRoute(organization: Organization): string | undefined {
  if (canAccessVaultTab(organization)) {
    return "vault";
  }
  if (canAccessMembersTab(organization)) {
    return "members";
  }
  if (canAccessGroupsTab(organization)) {
    return "groups";
  }
  if (canAccessReportingTab(organization)) {
    return "reporting";
  }
  if (canAccessSettingsTab(organization)) {
    return "settings";
  }
  return undefined;
}

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OrganizationsRoutingModule {}
