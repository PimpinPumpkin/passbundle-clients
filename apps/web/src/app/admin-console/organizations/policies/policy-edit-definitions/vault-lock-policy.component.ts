// Keykeeper: the "Vault lock" policy's page (upstream's vault timeout policy,
// type 9, whose own page isn't open source). It sets the data upstream's
// open-source clients read, `{ type, minutes, action }`, which the server
// checks and the PassBundle apps keep to. See docs/core.md, "Locking by
// policy", in the meta repo.
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";

import { PolicyType } from "@bitwarden/common/admin-console/enums";

import { SharedModule } from "../../../../shared";
import { BasePolicyEditDefinition, BasePolicyEditComponent } from "../base-policy-edit.component";
import { PolicyCategory } from "../pipes/policy-category";

export type VaultLockWhen = "custom" | "immediately" | "onSystemLock";
export type VaultLockAction = "lock" | "logOut";

/** The longest waits offered, in minutes. */
export const VAULT_LOCK_WAITS = [1, 5, 15, 30, 60, 240, 480, 1440];

/** A wait as the page says it: "15 minutes", "4 hours", "1 hour 30 minutes". */
export function waitLabel(minutes: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes === 1440) {
    return "1 day";
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return plural(rest, "minute");
  }
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}

export class VaultLockPolicy extends BasePolicyEditDefinition {
  name = "vaultLockPolicy";
  description = "vaultLockPolicyDesc";
  type = PolicyType.MaximumVaultTimeout;
  category = PolicyCategory.Authentication;
  priority = 40;
  component = VaultLockPolicyComponent;
}

@Component({
  selector: "vault-lock-policy-edit",
  templateUrl: "vault-lock-policy.component.html",
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultLockPolicyComponent extends BasePolicyEditComponent {
  private readonly formBuilder = inject(FormBuilder);

  readonly data = this.formBuilder.group({
    when: this.formBuilder.nonNullable.control<VaultLockWhen>("custom"),
    minutes: this.formBuilder.nonNullable.control(15),
    action: this.formBuilder.nonNullable.control<VaultLockAction>("lock"),
  });

  /** The waits to choose from, with one set elsewhere that isn't among them. */
  protected readonly waits = signal(VAULT_LOCK_WAITS);
  protected readonly waitLabel = waitLabel;

  protected override loadData() {
    const data = this.policyResponse()?.data;
    if (data == null) {
      return;
    }
    const when: VaultLockWhen =
      data.type === "immediately" || data.type === "onSystemLock" ? data.type : "custom";
    const minutes =
      Number.isInteger(data.minutes) && data.minutes > 0 && data.minutes <= 1440
        ? data.minutes
        : 15;
    if (!VAULT_LOCK_WAITS.includes(minutes)) {
      this.waits.set([...VAULT_LOCK_WAITS, minutes].sort((a, b) => a - b));
    }
    this.data.setValue({
      when,
      minutes,
      action: data.action === "logOut" ? "logOut" : "lock",
    });
  }

  protected override buildRequestData() {
    const { when, minutes, action } = this.data.getRawValue();
    return {
      type: when,
      minutes: when === "custom" ? minutes : null,
      action,
    };
  }
}
