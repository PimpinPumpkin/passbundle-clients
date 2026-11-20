// Keykeeper: enrolling people in account recovery at unlock, when their
// organization turned it on (or turned on its automatic enrollment) after
// they joined. Upstream enrolls someone automatically only as they accept an
// emailed invitation, so everyone already in the organization stayed out
// until they enrolled by hand from its options. At each unlock, for every
// organization where the person is confirmed and not enrolled yet, and whose
// Account recovery administration policy is on with automatic enrollment,
// this enrolls them with upstream's own enrollment
// (PasswordResetEnrollmentServiceImplementation.enroll): their user key,
// encrypted to the organization's public key as the server serves it, as
// accepting an invitation does. It says nothing: joining disclosed it, the
// organization's event log records it, and the organization's options show it
// as they do today. An organization gets at most one try per unlock,
// whatever happens: a refusal (an MSP's staff) or a failure (offline) waits
// for the next unlock.
//
// The web vault enrolls to the key the server serves: its code comes from
// the server, so a hacked server gains nothing it couldn't take anyway. An
// app whose code doesn't (the browser extension) passes a pin, and then
// enrolls only to the organization key the install command names, and sends
// nothing at all without one (see apps/browser/src/keykeeper/
// recovery-at-unlock.ts). See DESIGN.md, "Enrolling at unlock".

import {
  EMPTY,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  switchMap,
} from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { OrganizationUserStatusType, PolicyType } from "@bitwarden/common/admin-console/enums";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { Policy } from "@bitwarden/common/admin-console/models/domain/policy";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { PasswordResetEnrollmentServiceAbstraction } from "@bitwarden/common/auth/abstractions/password-reset-enrollment.service.abstraction";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import {
  KEYKEEPER_RECOVERY_MEMORY,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { KeyService } from "@bitwarden/key-management";

/**
 * Whether this unlock already had its try. Kept in memory, which the
 * extension keeps across its background's restarts, and cleared when the
 * account locks or signs out, so the next unlock tries again.
 */
export const KEYKEEPER_RECOVERY_TRIED = new UserKeyDefinition<boolean>(
  KEYKEEPER_RECOVERY_MEMORY,
  "triedThisUnlock",
  {
    deserializer: (tried) => tried === true,
    clearOn: ["lock", "logout"],
  },
);

/** Lets the sync an app starts as it unlocks finish first. */
const SETTLE_MS = 3000;

/** How long it waits for that sync when it's still under way after SETTLE_MS. */
const SYNC_WAIT_MS = 30_000;
const SYNC_POLL_MS = 250;

/**
 * For an app whose code doesn't come from the server: the one organization
 * key it may enroll to, as a fingerprint from outside the server (the
 * install command's), or null. Its enrollment checks the key against it
 * (KeykeeperPinnedOrganizationApiService in the extension); this only makes
 * sure that without a pin nothing is sent at all.
 */
export interface RecoveryKeyPin {
  pin(): Promise<string | null>;
}

/** An organization key that isn't the pinned one: never enrolled to, and said in the log. */
export class RecoveryKeyRefused extends Error {
  override name = "RecoveryKeyRefused";
}

/** Why an app with a pin sends nothing where there is none. */
export const NO_RECOVERY_PIN =
  "This browser's install command names no organization key, so the extension doesn't enroll you in account recovery. The web vault does, the next time you unlock it.";

/** What happened in one organization, for the log and for tests. */
export type RecoveryAtUnlock = {
  organizationId: string;
  enrolled: boolean;
  /** Why not, in a sentence: the server's refusal, or being offline. */
  error?: string;
};

/**
 * Whether this membership is due to be enrolled: confirmed, not from an MSP
 * (the server never enrolls an MSP's staff, so their key isn't sent), not
 * enrolled yet, in an organization that offers account recovery (as
 * upstream's organization options decide) and whose policy is on with
 * automatic enrollment.
 */
export function dueForRecovery(organization: Organization, policies: Policy[]): boolean {
  if (
    organization.status !== OrganizationUserStatusType.Confirmed ||
    organization.keykeeperFromMsp ||
    organization.resetPasswordEnrolled ||
    !organization.usePolicies ||
    !organization.useResetPassword ||
    !organization.hasPublicAndPrivateKeys
  ) {
    return false;
  }
  const policy = policies.find(
    (p) => p.type === PolicyType.ResetPassword && p.organizationId === organization.id,
  );
  return policy?.enabled === true && policy.data?.autoEnrollEnabled === true;
}

export class KeykeeperRecoveryAtUnlock {
  /** The run in progress for each account, so two triggers can't both try. */
  private readonly running = new Map<UserId, Promise<RecoveryAtUnlock[]>>();

  constructor(
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly organizationService: OrganizationService,
    private readonly policyService: PolicyService,
    private readonly syncService: SyncService,
    private readonly keyService: KeyService,
    /** Upstream's enrollment, as accepting an invitation and enrolling by hand use. */
    private readonly enrollment: PasswordResetEnrollmentServiceAbstraction,
    private readonly stateProvider: StateProvider,
    private readonly logService: LogService,
    private readonly options: {
      /** Only for an app whose code doesn't come from the server; see RecoveryKeyPin. */
      pin?: RecoveryKeyPin;
      settleMs?: number;
      syncWaitMs?: number;
    } = {},
  ) {}

  /** Runs each time the active account becomes unlocked. */
  start() {
    this.accountService.activeAccount$
      .pipe(
        getOptionalUserId,
        switchMap((userId) =>
          userId == null
            ? EMPTY
            : this.authService.authStatusFor$(userId).pipe(
                map((status) => status === AuthenticationStatus.Unlocked),
                distinctUntilChanged(),
                filter((unlocked) => unlocked),
                map(() => userId),
              ),
        ),
        debounceTime(this.options.settleMs ?? SETTLE_MS),
      )
      .subscribe((userId) => void this.run(userId));
  }

  /**
   * Enrolls the person in every organization they're due in, once per
   * unlock. Never throws and never tells the person; resolves to what
   * happened in each organization it tried.
   */
  run(userId: UserId): Promise<RecoveryAtUnlock[]> {
    const running = this.running.get(userId);
    if (running != null) {
      return running;
    }
    const run = this.runOnce(userId)
      .catch((e: unknown): RecoveryAtUnlock[] => {
        this.logService.warning(`Account recovery at unlock: ${plainErrorMessage(e)}`);
        return [];
      })
      .finally(() => this.running.delete(userId));
    this.running.set(userId, run);
    return run;
  }

  private async runOnce(userId: UserId): Promise<RecoveryAtUnlock[]> {
    // Requests go out as the active account, and need its user key.
    const active = await firstValueFrom(this.accountService.activeAccount$.pipe(getOptionalUserId));
    if (
      active !== userId ||
      (await firstValueFrom(this.authService.authStatusFor$(userId))) !==
        AuthenticationStatus.Unlocked
    ) {
      return [];
    }
    const tried = this.stateProvider.getUser(userId, KEYKEEPER_RECOVERY_TRIED);
    if ((await firstValueFrom(tried.state$)) === true) {
      return [];
    }
    // Marked first, so nothing can make this unlock try twice.
    await tried.update(() => true);

    // What the device has, once the sync the app makes as it unlocks is in:
    // signing in and the lock screen sync, and turning the policy on
    // changes every member's account, so a policy turned on since the last
    // sync counts. This starts no sync of its own: one landing in the
    // middle of something else (an item saved twice in a row, a selection
    // in the admin console) would put back what the server had a moment
    // before.
    await this.appSyncDone(userId);
    const [organizations, policies, userKey] = await Promise.all([
      firstValueFrom(this.organizationService.organizations$(userId)),
      firstValueFrom(this.policyService.policies$(userId)),
      firstValueFrom(this.keyService.userKey$(userId)),
    ]);
    if (userKey == null) {
      return [];
    }
    const due = organizations.filter((o) => dueForRecovery(o, policies));
    if (due.length === 0) {
      return [];
    }
    if (this.options.pin != null && (await this.options.pin.pin()) == null) {
      // Not even the organization's key is fetched.
      this.logService.info(`Account recovery at unlock: ${NO_RECOVERY_PIN}`);
      return due.map((o) => ({ organizationId: o.id, enrolled: false, error: NO_RECOVERY_PIN }));
    }
    const outcomes: RecoveryAtUnlock[] = [];
    for (const organization of due) {
      try {
        await this.enrollment.enroll(organization.id, userId, userKey);
        outcomes.push({ organizationId: organization.id, enrolled: true });
      } catch (e) {
        if (e instanceof RecoveryKeyRefused) {
          // The key the server served isn't the pinned one: nothing was sent.
          this.logService.warning(
            `Account recovery at unlock in ${organization.name} (${organization.id}): ${e.message}`,
          );
          outcomes.push({ organizationId: organization.id, enrolled: false, error: e.message });
          continue;
        }
        // Quietly: the server refused (an MSP's staff) or couldn't be
        // reached. The next unlock tries again.
        const error = plainErrorMessage(e);
        this.logService.info(`Account recovery at unlock in ${organization.id}: ${error}`);
        outcomes.push({ organizationId: organization.id, enrolled: false, error });
      }
    }
    if (outcomes.some((o) => o.enrolled)) {
      // So the organization's options show it, as after enrolling by hand.
      await this.syncService.fullSync(true);
    }
    return outcomes;
  }

  /**
   * Waits for a sync the app still has under way, up to SYNC_WAIT_MS and
   * while the account stays unlocked, so what the device has includes it.
   * Never starts one.
   */
  private async appSyncDone(userId: UserId): Promise<void> {
    const until = Date.now() + (this.options.syncWaitMs ?? SYNC_WAIT_MS);
    while (
      this.syncService.syncInProgress === true &&
      Date.now() < until &&
      (await firstValueFrom(this.authService.authStatusFor$(userId))) ===
        AuthenticationStatus.Unlocked
    ) {
      await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
    }
  }
}
