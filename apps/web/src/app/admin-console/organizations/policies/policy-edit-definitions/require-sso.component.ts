import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { of } from "rxjs";

import { SsoView } from "@bitwarden/admin-console/common";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";

import { KeykeeperMspApiService } from "../../../../keykeeper/msp/msp-api.service";
import { SharedModule } from "../../../../shared";
import { BasePolicyEditDefinition, BasePolicyEditComponent } from "../base-policy-edit.component";
import { PolicyCategory } from "../pipes/policy-category";

import { SimpleTogglePolicyComponent } from "./simple-toggle-policy.component";

export class RequireSsoPolicy extends BasePolicyEditDefinition {
  name = "requireSso";
  description = "requireSsoPolicyDesc";
  type = PolicyType.RequireSso;
  category = PolicyCategory.Authentication;
  priority = 30;
  component = RequireSsoPolicyComponent;
  v2 = {
    component: SimpleTogglePolicyComponent,
    name: "requireSsoPolicyTitle",
    description: "requireSsoPolicyDescV2",
    prerequisiteKey: "requireSsoPolicyReqV2",
  };

  display$(organization: Organization, configService: ConfigService) {
    return of(organization.useSso);
  }
}

@Component({
  selector: "require-sso-policy-edit",
  templateUrl: "require-sso.component.html",
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequireSsoPolicyComponent extends BasePolicyEditComponent implements OnInit {
  private readonly keykeeperApi = inject(KeykeeperMspApiService);
  /**
   * Keykeeper: the members this policy covers who aren't linked to single
   * sign-on yet, so admins see who will be asked to link before turning it on
   * (DESIGN.md, "Sign in with Microsoft Entra ID"). Null until loaded.
   */
  protected readonly keykeeperUnlinked = signal<SsoView["unlinked"] | null>(null);

  override ngOnInit(): void {
    super.ngOnInit();
    const orgId = this.organizationId() ?? this.policyResponse()?.organizationId;
    if (orgId != null) {
      this.keykeeperApi.getSso(orgId).then(
        (view) => this.keykeeperUnlinked.set(view.unlinked ?? []),
        () => this.keykeeperUnlinked.set(null),
      );
    }
  }
}
