import { ChangeDetectionStrategy, Component } from "@angular/core";

import { KEYKEEPER_MEMBER_HEALTH_POLICY } from "@bitwarden/admin-console/common";
import { PolicyType } from "@bitwarden/common/admin-console/enums";

import {
  BasePolicyEditComponent,
  BasePolicyEditDefinition,
  PolicyCategory,
} from "../../admin-console/organizations/policies";
import { SharedModule } from "../../shared";

/**
 * Keykeeper: "Members' own passwords" as one of an MSP's default policies
 * (DESIGN.md, "Members' own passwords"): whether each client's owners and
 * admins see how many of its members' own passwords are weak, reused, or
 * exposed. It has no options. It isn't an upstream policy, so it's never in
 * the admin console's register: a client's own setting is on its Settings
 * page, and this form is only for the MSP console's Default policies.
 */
export class KeykeeperMemberHealthPolicy extends BasePolicyEditDefinition {
  name = "keykeeperMemberHealthPolicy";
  description = "keykeeperMemberHealthPolicyDesc";
  type = KEYKEEPER_MEMBER_HEALTH_POLICY as PolicyType;
  category = PolicyCategory.DataControl;
  priority = 99;
  component = KeykeeperMemberHealthPolicyComponent;
}

/** No options: on or off, so its data is always null. */
@Component({
  selector: "app-keykeeper-member-health-policy-edit",
  template: `
    <bit-form-control>
      <input type="checkbox" bitCheckbox [formControl]="enabled" />
      <bit-label>{{ "turnOn" | i18n }}</bit-label>
    </bit-form-control>
  `,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeykeeperMemberHealthPolicyComponent extends BasePolicyEditComponent {}

/** The MSP console's default policy forms, with Members' own passwords last, when the server offers it. */
export function withMemberHealth(
  definitions: BasePolicyEditDefinition[],
  offered: number[],
): BasePolicyEditDefinition[] {
  if (!offered.includes(KEYKEEPER_MEMBER_HEALTH_POLICY)) {
    return definitions;
  }
  return [...definitions, new KeykeeperMemberHealthPolicy()];
}
