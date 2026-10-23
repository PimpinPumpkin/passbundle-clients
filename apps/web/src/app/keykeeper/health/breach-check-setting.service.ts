import { Injectable } from "@angular/core";
import { distinctUntilChanged, map, Observable, of, switchMap } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { UserId } from "@bitwarden/common/types/guid";
import { KEYKEEPER_HEALTH_DISK, StateProvider, UserKeyDefinition } from "@bitwarden/state";

/** On until the person turns it off; null (never set) counts as on. */
export const CHECK_AFTER_UNLOCK = new UserKeyDefinition<boolean>(
  KEYKEEPER_HEALTH_DISK,
  "checkAfterUnlock",
  {
    deserializer: (on) => on !== false,
    clearOn: [],
  },
);

/**
 * Keykeeper: the setting "Check my passwords against known breaches after
 * unlocking" (Settings, Appearance), per account. On by default. Off, the
 * count beside Health is weak and reused only and the MSP console waits for
 * its Check exposed passwords button, so nothing goes to the breach service
 * unless the person opens the exposed passwords report or presses Check. See
 * DESIGN.md, "Exposed passwords".
 */
@Injectable({ providedIn: "root" })
export class KeykeeperBreachCheckSetting {
  constructor(
    private readonly stateProvider: StateProvider,
    private readonly accountService: AccountService,
  ) {}

  /** Whether this account's passwords are checked on their own. */
  checksAfterUnlock$(userId: UserId): Observable<boolean> {
    return this.stateProvider.getUser(userId, CHECK_AFTER_UNLOCK).state$.pipe(
      map((on) => on !== false),
      distinctUntilChanged(),
    );
  }

  /** The same, for whoever is signed in. */
  readonly activeChecksAfterUnlock$: Observable<boolean> = this.accountService.activeAccount$.pipe(
    switchMap((account) => (account == null ? of(true) : this.checksAfterUnlock$(account.id))),
  );

  async setChecksAfterUnlock(userId: UserId, on: boolean): Promise<void> {
    await this.stateProvider.getUser(userId, CHECK_AFTER_UNLOCK).update(() => on);
  }
}
