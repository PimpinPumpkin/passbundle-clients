// Keykeeper: the "Vault lock" policy's page (upstream's vault timeout policy,
// type 9, whose own page isn't open source). It sets the data upstream's
// open-source clients read, `{ type, minutes, action }`, which the server
// checks and the PassBundle apps keep to, plus `webMinutes` with "when the
// computer locks": the web vault's wait, since a web page can't see the
// computer lock. See docs/core.md, "Locking by policy", in the meta repo.
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";

import { PolicyType } from "@bitwarden/common/admin-console/enums";
import {
  KEYKEEPER_WEB_MINUTES_DEFAULT,
  keykeeperWaitLabel,
} from "@bitwarden/common/key-management/session-timeout";

import { SharedModule } from "../../../../shared";
import { BasePolicyEditDefinition, BasePolicyEditComponent } from "../base-policy-edit.component";
import { PolicyCategory } from "../pipes/policy-category";

export type VaultLockWhen = "custom" | "immediately" | "onSystemLock";
export type VaultLockAction = "lock" | "logOut";

/** The longest waits offered, in minutes. */
export const VAULT_LOCK_WAITS = [1, 5, 15, 30, 60, 240, 480, 1440];

/** A wait as the page says it: "15 minutes", "4 hours", "1 hour 30 minutes". */
export const waitLabel = keykeeperWaitLabel;

/** A wait set elsewhere, if it's one the page can show; otherwise the default. */
function readWait(minutes: unknown): number {
  return Number.isInteger(minutes) && (minutes as number) > 0 && (minutes as number) <= 1440
    ? (minutes as number)
    : 15;
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
    webMinutes: this.formBuilder.nonNullable.control(KEYKEEPER_WEB_MINUTES_DEFAULT),
    action: this.formBuilder.nonNullable.control<VaultLockAction>("lock"),
  });

  /** The waits to choose from, with one set elsewhere that isn't among them. */
  protected readonly waits = signal(VAULT_LOCK_WAITS);
  /** The same for the web vault's wait under "when the computer locks". */
  protected readonly webWaits = signal(VAULT_LOCK_WAITS);
  protected readonly waitLabel = waitLabel;

  protected override loadData() {
    const data = this.policyResponse()?.data;
    if (data == null) {
      return;
    }
    const when: VaultLockWhen =
      data.type === "immediately" || data.type === "onSystemLock" ? data.type : "custom";
    const withWait = (waits: number[], minutes: number) =>
      waits.includes(minutes) ? waits : [...waits, minutes].sort((a, b) => a - b);
    const minutes = readWait(data.minutes);
    this.waits.set(withWait(VAULT_LOCK_WAITS, minutes));
    const webMinutes =
      when === "onSystemLock" && data.webMinutes != null
        ? readWait(data.webMinutes)
        : KEYKEEPER_WEB_MINUTES_DEFAULT;
    this.webWaits.set(withWait(VAULT_LOCK_WAITS, webMinutes));
    this.data.setValue({
      when,
      minutes,
      webMinutes,
      action: data.action === "logOut" ? "logOut" : "lock",
    });
  }

  protected override buildRequestData() {
    const { when, minutes, webMinutes, action } = this.data.getRawValue();
    return {
      type: when,
      minutes: when === "custom" ? minutes : null,
      // The server takes it only with "when the computer locks".
      ...(when === "onSystemLock" ? { webMinutes } : {}),
      action,
    };
  }
}
