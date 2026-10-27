import { ChangeDetectionStrategy, Component } from "@angular/core";

import { KEYKEEPER_ADMIN_TWO_STEP_POLICY } from "@bitwarden/admin-console/common";
import { PolicyType } from "@bitwarden/common/admin-console/enums";

import {
  BasePolicyEditComponent,
  BasePolicyEditDefinition,
  PolicyCategory,
} from "../../admin-console/organizations/policies";
import { SharedModule } from "../../shared";

/**
 * Keykeeper: two-step login for each client's admins, as one of an MSP's
 * default policies (DESIGN.md, "Two-step login for admins"). It isn't an
 * upstream policy, so it's never in the admin console's register: a client's
 * own setting is on its Settings page, and this form is only for the MSP
 * console's Default policies, which saves it with the MSP's other defaults.
 */
export class KeykeeperAdminTwoStepPolicy extends BasePolicyEditDefinition {
  name = "keykeeperAdminTwoStepPolicy";
  description = "keykeeperAdminTwoStepPolicyDesc";
  type = KEYKEEPER_ADMIN_TWO_STEP_POLICY as PolicyType;
  category = PolicyCategory.Authentication;
  priority = 11;
  component = KeykeeperAdminTwoStepPolicyComponent;
}

@Component({
  selector: "app-keykeeper-admin-two-step-policy-edit",
  template: `
    <bit-form-control>
      <input type="checkbox" bitCheckbox [formControl]="enabled" />
      <bit-label>{{ "turnOn" | i18n }}</bit-label>
    </bit-form-control>
  `,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeykeeperAdminTwoStepPolicyComponent extends BasePolicyEditComponent {}

/**
 * The MSP console's default policy forms in the admin console's order, with
 * two-step login for admins right after upstream's two-step login, when the
 * server offers it.
 */
export function withAdminTwoStep(
  definitions: BasePolicyEditDefinition[],
  offered: number[],
): BasePolicyEditDefinition[] {
  if (!offered.includes(KEYKEEPER_ADMIN_TWO_STEP_POLICY)) {
    return definitions;
  }
  const ours = new KeykeeperAdminTwoStepPolicy();
  const after = definitions.findIndex((d) => d.type === PolicyType.TwoFactorAuthentication);
  const out = [...definitions];
  out.splice(after + 1, 0, ours);
  return out;
}
