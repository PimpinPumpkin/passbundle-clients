import { ChangeDetectionStrategy, Component } from "@angular/core";

import { KEYKEEPER_PASSWORD_CHANGE_OFF_POLICY } from "@bitwarden/admin-console/common";
import { PolicyType } from "@bitwarden/common/admin-console/enums";

import {
  BasePolicyEditComponent,
  BasePolicyEditDefinition,
  PolicyCategory,
} from "../../admin-console/organizations/policies";
import { SharedModule } from "../../shared";

/**
 * Keykeeper: "Turn off assisted password change", as one of an MSP's default
 * policies (DESIGN.md, "Assisted password change", "Organizations"). On, a
 * client turns it off for its items; without it, clients allow it. It isn't
 * an upstream policy, so it's never in the admin console's register: a
 * client's own setting is on its Settings page, and this form is only for the
 * MSP console's Default policies.
 */
export class KeykeeperPasswordChangeOffPolicy extends BasePolicyEditDefinition {
  name = "keykeeperPasswordChangeOffPolicy";
  description = "keykeeperPasswordChangeOffPolicyDesc";
  type = KEYKEEPER_PASSWORD_CHANGE_OFF_POLICY as PolicyType;
  category = PolicyCategory.VaultManagement;
  priority = 200;
  component = KeykeeperPasswordChangeOffPolicyComponent;
}

/** On or off, with no options. */
@Component({
  selector: "app-keykeeper-password-change-off-policy-edit",
  template: `
    <bit-form-control>
      <input type="checkbox" bitCheckbox [formControl]="enabled" />
      <bit-label>{{ "turnOn" | i18n }}</bit-label>
    </bit-form-control>
  `,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeykeeperPasswordChangeOffPolicyComponent extends BasePolicyEditComponent {}

/** The MSP console's default policy forms, with this one last when the server offers it. */
export function withPasswordChangeOff(
  definitions: BasePolicyEditDefinition[],
  offered: number[],
): BasePolicyEditDefinition[] {
  return offered.includes(KEYKEEPER_PASSWORD_CHANGE_OFF_POLICY)
    ? [...definitions, new KeykeeperPasswordChangeOffPolicy()]
    : definitions;
}
