import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { of } from "rxjs";

import { SsoView } from "@bitwarden/admin-console/common";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { SwitchComponent } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../../../../keykeeper/msp/msp-api.service";
import { SharedModule } from "../../../../shared";
import { BasePolicyEditDefinition, BasePolicyEditComponent } from "../base-policy-edit.component";
import { PolicyCategory } from "../pipes/policy-category";

export class RequireSsoPolicy extends BasePolicyEditDefinition {
  name = "requireSsoPolicyTitle";
  nameVfo1 = "requireSsoVfo1";
  description = "requireSsoPolicyDescV2";
  descriptionVfo1 = "requireSsoPolicyDescListV2Vfo1";
  drawerDescriptionVfo1 = "requireSsoPolicyDescV2";
  type = PolicyType.RequireSso;
  category = PolicyCategory.Authentication;
  priority = 30;
  // Keykeeper: upstream's switch, plus who isn't linked yet (RequireSsoPolicyComponent).
  component = RequireSsoPolicyComponent;
  prerequisiteKey = "requireSsoPolicyReqV2";
  prerequisiteKeyVfo1 = "requireSsoPolicyReqV2Vfo1";

  display$(organization: Organization, configService: ConfigService) {
    return of(organization.useSso);
  }
}

@Component({
  selector: "require-sso-policy-edit",
  templateUrl: "require-sso.component.html",
  imports: [SharedModule, SwitchComponent],
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
