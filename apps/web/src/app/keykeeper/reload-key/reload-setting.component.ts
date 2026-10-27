// Keykeeper: "Stay unlocked when I reload", on Settings, Security, Session
// timeout, under the timeout. On by default; someone on a shared computer
// turns it off, so every reload asks for the master password. A Vault lock
// policy can turn it off for its members (`webReload: false`), and so do
// policies that lock at every reload. It's off while the person's own
// timeout is "On browser refresh", and a policy that replaces that turns it
// off, with a note saying why. See reload-key.ts, and DESIGN.md, "Staying
// unlocked across a reload", in the meta repo.
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormControl } from "@angular/forms";
import { combineLatest, concatMap, map, switchMap } from "rxjs";

import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { getFirstPolicy } from "@bitwarden/common/admin-console/services/policy/default-policy.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import {
  keykeeperWaitLabel,
  keykeeperWebMinutes,
  MaximumSessionTimeoutPolicyData,
} from "@bitwarden/common/key-management/session-timeout";
import { UserId } from "@bitwarden/common/types/guid";

import { SharedModule } from "../../shared";

import { ReloadSetting } from "./reload-key";
import { KeykeeperReloadKeyService } from "./reload-key.service";

/** Why a policy keeps someone's web vault from staying unlocked across a reload, if it does. */
export function reloadRefusal(policy: MaximumSessionTimeoutPolicyData | null): string | null {
  if (policy == null) {
    return null;
  }
  if (policy.webReload === false) {
    return "Your organization turned this off: every reload asks for your master password.";
  }
  if (policy.type === "immediately" || policy.type === "onAppRestart") {
    return "Your organization locks the vault at every reload.";
  }
  if (policy.action === "logOut") {
    return "Your organization signs you out when the vault locks, so a reload signs you out.";
  }
  return null;
}

/** Why the setting is off when the person didn't turn it off, if it is. */
export function reloadNote(
  setting: ReloadSetting,
  policy: MaximumSessionTimeoutPolicyData | null,
): string | null {
  switch (setting.because) {
    case "onBrowserRefresh":
      return policy?.type === "onSystemLock"
        ? "Off while your own timeout is On browser refresh, which locks at every reload. " +
            `Your organization's policy shows ${keykeeperWaitLabel(keykeeperWebMinutes(policy))} ` +
            "here instead; choose another timeout above to stay unlocked when you reload."
        : "Off while your timeout is On browser refresh, which locks at every reload.";
    case "onBrowserRefreshReplaced":
      return (
        "Turned off because your organization's policy replaced your timeout of On browser " +
        "refresh, which locked at every reload. Turn it on to stay unlocked when you reload."
      );
    default:
      return null;
  }
}

export const STAY_UNLOCKED_HINT =
  "With a timeout in minutes and the Lock action, reloading this page keeps your vault " +
  "unlocked until the timeout. Turn this off on a shared computer, so that every reload " +
  "asks for your master password.";

@Component({
  selector: "keykeeper-reload-setting",
  templateUrl: "reload-setting.component.html",
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeykeeperReloadSettingComponent {
  private readonly reloadKey = inject(KeykeeperReloadKeyService);
  private readonly accountService = inject(AccountService);
  private readonly policyService = inject(PolicyService);

  readonly stay = new FormControl(true, { nonNullable: true });
  protected readonly note = signal<string | null>(null);
  protected readonly hint = STAY_UNLOCKED_HINT;
  private readonly userId = signal<UserId | null>(null);

  constructor() {
    const userId$ = this.accountService.activeAccount$.pipe(getUserId);
    combineLatest([
      userId$,
      userId$.pipe(switchMap((userId) => this.reloadKey.reloadSetting$(userId))),
      userId$.pipe(
        switchMap((userId) =>
          this.policyService.policiesByType$(PolicyType.MaximumVaultTimeout, userId),
        ),
        getFirstPolicy,
        map((policy) => (policy?.data ?? null) as MaximumSessionTimeoutPolicyData | null),
      ),
    ])
      .pipe(takeUntilDestroyed())
      .subscribe(([userId, setting, policy]) => {
        this.userId.set(userId);
        const refusal = reloadRefusal(policy);
        this.note.set(refusal ?? reloadNote(setting, policy));
        this.stay.setValue(refusal == null && setting.on, { emitEvent: false });
        if (refusal == null && setting.because !== "onBrowserRefresh") {
          this.stay.enable({ emitEvent: false });
        } else {
          this.stay.disable({ emitEvent: false });
        }
      });

    this.stay.valueChanges
      .pipe(
        concatMap(async (on) => {
          const userId = this.userId();
          if (userId != null) {
            await this.reloadKey.setStayUnlocked(userId, on);
          }
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }
}
