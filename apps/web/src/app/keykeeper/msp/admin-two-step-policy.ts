import { ChangeDetectionStrategy, Component } from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";

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
 * default policies (DESIGN.md, "Two-step login for admins"), with one option:
 * everyone else too ("Two-step login for everyone"). It isn't an upstream
 * policy, so it's never in the admin console's register: a client's own
 * setting is on its Settings page, and this form is only for the MSP
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
    <div [formGroup]="data">
      <bit-form-control class="tw-ml-6">
        <input type="checkbox" bitCheckbox formControlName="everyone" />
        <bit-label>Everyone else too</bit-label>
        <bit-hint>
          Every member of each client, whatever their role, with the same methods. Members without
          one are signed out, and set it up the next time they sign in.
        </bit-hint>
      </bit-form-control>
    </div>
  `,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeykeeperAdminTwoStepPolicyComponent extends BasePolicyEditComponent {
  override data = new FormGroup({
    everyone: new FormControl(false, { nonNullable: true }),
  });

  /** Its one option when it's on, and null without it, as it always was. */
  protected override buildRequestData() {
    return everyoneData(this.enabled.value === true, this.data.controls.everyone.value);
  }
}

/** Two-step login for admins' data: `{ everyone: true }`, or null without it. */
export function everyoneData(enabled: boolean, everyone: boolean): { everyone: true } | null {
  return enabled && everyone ? { everyone: true } : null;
}

/** Whether a default's or a client's data asks for everyone else too. */
export function requiresEveryone(data: unknown): boolean {
  return (data as { everyone?: unknown } | null)?.everyone === true;
}

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
