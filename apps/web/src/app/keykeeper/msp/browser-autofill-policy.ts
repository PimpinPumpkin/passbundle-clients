import { ChangeDetectionStrategy, Component } from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";

import { KEYKEEPER_BROWSER_AUTOFILL_OFF_POLICY } from "@bitwarden/admin-console/common";
import { PolicyType } from "@bitwarden/common/admin-console/enums";

import {
  BasePolicyEditComponent,
  BasePolicyEditDefinition,
  PolicyCategory,
} from "../../admin-console/organizations/policies";
import { SharedModule } from "../../shared";

/**
 * Keykeeper: "Turn off the browsers' card and address autofill", as one of an
 * MSP's default policies (DESIGN.md, "Addresses and cards"), with one option:
 * offer to bring saved cards and addresses into PassBundle. On, a client
 * turns off Chrome's, Edge's, and Firefox's own card and address autofill;
 * without it, clients leave them as they are. It isn't an upstream policy, so
 * it's never in the admin console's register: a client's own setting is on
 * its Settings page, and this form is only for the MSP console's Default
 * policies.
 */
export class KeykeeperBrowserAutofillOffPolicy extends BasePolicyEditDefinition {
  name = "keykeeperBrowserAutofillOffPolicy";
  description = "keykeeperBrowserAutofillOffPolicyDesc";
  type = KEYKEEPER_BROWSER_AUTOFILL_OFF_POLICY as PolicyType;
  category = PolicyCategory.VaultManagement;
  priority = 201;
  component = KeykeeperBrowserAutofillOffPolicyComponent;
}

@Component({
  selector: "app-keykeeper-browser-autofill-off-policy-edit",
  template: `
    <bit-form-control>
      <input type="checkbox" bitCheckbox [formControl]="enabled" />
      <bit-label>{{ "turnOn" | i18n }}</bit-label>
    </bit-form-control>
    <div [formGroup]="data">
      <bit-form-control class="tw-ml-6">
        <input type="checkbox" bitCheckbox formControlName="offer" />
        <bit-label>Offer to bring them in</bit-label>
        <bit-hint>
          The extension offers each person, once, to move their saved cards and addresses into
          {{ "keykeeperProductName" | i18n }}.
        </bit-hint>
      </bit-form-control>
    </div>
  `,
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeykeeperBrowserAutofillOffPolicyComponent extends BasePolicyEditComponent {
  override data = new FormGroup({
    offer: new FormControl(false, { nonNullable: true }),
  });

  /** Its one option when it's on, and null without it. */
  protected override buildRequestData() {
    return offerData(this.enabled.value === true, this.data.controls.offer.value);
  }
}

/** The default's data: `{ offer: true }`, or null without it. */
export function offerData(enabled: boolean, offer: boolean): { offer: true } | null {
  return enabled && offer ? { offer: true } : null;
}

/** Whether a default's or a client's data asks for the offer. */
export function offersImport(data: unknown): boolean {
  return (data as { offer?: unknown } | null)?.offer === true;
}

/** The MSP console's default policy forms, with this one last when the server offers it. */
export function withBrowserAutofillOff(
  definitions: BasePolicyEditDefinition[],
  offered: number[],
): BasePolicyEditDefinition[] {
  return offered.includes(KEYKEEPER_BROWSER_AUTOFILL_OFF_POLICY)
    ? [...definitions, new KeykeeperBrowserAutofillOffPolicy()]
    : definitions;
}
