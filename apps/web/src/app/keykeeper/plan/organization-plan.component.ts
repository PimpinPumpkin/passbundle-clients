import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { combineLatest, map, switchMap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

import { KeykeeperPlanViewComponent } from "./plan-view.component";

/**
 * Keykeeper: an organization's Plan page, in the admin console where
 * upstream's Billing pages were (DESIGN.md, "Plans and billing"), for its
 * owners and whoever manages its plan. A client of an MSP says "Covered by"
 * and the MSP's name, and has no button: the pool is paid for in the MSP
 * console.
 */
@Component({
  selector: "app-keykeeper-organization-plan",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule, KeykeeperPlanViewComponent],
  template: `
    <app-header></app-header>
    <bit-container>
      @if (organization(); as org) {
        @if (org.keykeeperPlan.enforced ? org.keykeeperPlan : null; as plan) {
          <app-keykeeper-plan-view
            [plan]="plan"
            [whose]="{ kind: 'organization', id: org.id, name: org.name }"
          />
        }
      }
    </bit-container>
  `,
})
export class KeykeeperOrganizationPlanComponent {
  private readonly organizationService = inject(OrganizationService);

  protected readonly organization = toSignal(
    combineLatest([
      inject(AccountService).activeAccount$.pipe(
        getUserId,
        switchMap((userId) => this.organizationService.organizations$(userId)),
      ),
      inject(ActivatedRoute).paramMap,
    ]).pipe(
      map(
        ([organizations, params]) =>
          organizations.find((org) => org.id === params.get("organizationId")) ?? null,
      ),
    ),
  );
}
