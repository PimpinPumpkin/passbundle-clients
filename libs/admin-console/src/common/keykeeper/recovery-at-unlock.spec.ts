import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { OrganizationUserStatusType, PolicyType } from "@bitwarden/common/admin-console/enums";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { Policy } from "@bitwarden/common/admin-console/models/domain/policy";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { PasswordResetEnrollmentServiceAbstraction } from "@bitwarden/common/auth/abstractions/password-reset-enrollment.service.abstraction";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import {
  dueForRecovery,
  KEYKEEPER_RECOVERY_TRIED,
  KeykeeperRecoveryAtUnlock,
  NO_RECOVERY_PIN,
  RecoveryKeyPin,
  RecoveryKeyRefused,
} from "./recovery-at-unlock";

const USER = "user-1" as UserId;
const USER_KEY = { key: "the user key" } as unknown as UserKey;

/** A membership as the person's sync has it: confirmed, not enrolled, in an organization with keys. */
const membership = (id: string, changes: Partial<Organization> = {}) =>
  ({
    id,
    name: `Org ${id}`,
    status: OrganizationUserStatusType.Confirmed,
    keykeeperFromMsp: false,
    resetPasswordEnrolled: false,
    usePolicies: true,
    useResetPassword: true,
    hasPublicAndPrivateKeys: true,
    ...changes,
  }) as Organization;

/** The organization's Account recovery administration policy. */
const recoveryPolicy = (organizationId: string, enabled = true, autoEnrollEnabled = true) =>
  ({
    organizationId,
    type: PolicyType.ResetPassword,
    enabled,
    data: { autoEnrollEnabled },
  }) as Policy;

/** The server's refusal of an MSP staff member, as upstream's API service throws it. */
const mspStaffRefusal = () =>
  new ErrorResponse({ message: "MSP staff can't join an organization's account recovery" }, 400);

/** What fetch throws without a network. */
const offline = () => new TypeError("Failed to fetch");

function setup(
  organizations: Organization[],
  policies: Policy[],
  status = AuthenticationStatus.Unlocked,
  pin?: RecoveryKeyPin,
) {
  const accountService = mock<AccountService>();
  const activeAccount = new BehaviorSubject<{ id: UserId } | null>({ id: USER });
  accountService.activeAccount$ = activeAccount as any;
  const authStatus = new BehaviorSubject(status);
  const authService = mock<AuthService>();
  authService.authStatusFor$.mockReturnValue(authStatus);
  const organizations$ = new BehaviorSubject(organizations);
  const organizationService = mock<OrganizationService>();
  organizationService.organizations$.mockReturnValue(organizations$);
  const policies$ = new BehaviorSubject(policies);
  const policyService = mock<PolicyService>();
  policyService.policies$.mockReturnValue(policies$);
  const syncService = mock<SyncService>();
  syncService.fullSync.mockResolvedValue(true);
  const keyService = mock<KeyService>();
  keyService.userKey$.mockReturnValue(of(USER_KEY));
  const enrollment = mock<PasswordResetEnrollmentServiceAbstraction>();
  enrollment.enroll.mockResolvedValue(undefined);
  const stateProvider = new FakeStateProvider(mockAccountServiceWith(USER));
  const logService = mock<LogService>();
  const recovery = new KeykeeperRecoveryAtUnlock(
    accountService,
    authService,
    organizationService,
    policyService,
    syncService,
    keyService,
    enrollment,
    stateProvider,
    logService,
    { pin, settleMs: 0 },
  );
  /** What clearOn: ["lock"] does when the account locks, then unlocking again. */
  const lockAndUnlock = async () => {
    authStatus.next(AuthenticationStatus.Locked);
    await stateProvider.setUserState(KEYKEEPER_RECOVERY_TRIED, null, USER);
    authStatus.next(AuthenticationStatus.Unlocked);
  };
  return {
    recovery,
    enrollment,
    syncService,
    logService,
    organizations$,
    policies$,
    authStatus,
    activeAccount,
    lockAndUnlock,
  };
}

describe("enrolling in account recovery at unlock", () => {
  it("enrolls a confirmed member who isn't enrolled, where the policy is on with automatic enrollment, with upstream's enrollment", async () => {
    const { recovery, enrollment, syncService } = setup(
      [membership("dental")],
      [recoveryPolicy("dental")],
    );

    const outcomes = await recovery.run(USER);

    expect(outcomes).toEqual([{ organizationId: "dental", enrolled: true }]);
    expect(enrollment.enroll).toHaveBeenCalledTimes(1);
    expect(enrollment.enroll).toHaveBeenCalledWith("dental", USER, USER_KEY);
    // Synced first, for a policy turned on since, and again after, for the organization's options.
    expect(syncService.fullSync).toHaveBeenNthCalledWith(1, false);
    expect(syncService.fullSync).toHaveBeenNthCalledWith(2, true);
  });

  it("does nothing for someone already enrolled", async () => {
    const { recovery, enrollment, syncService } = setup(
      [membership("dental", { resetPasswordEnrolled: true })],
      [recoveryPolicy("dental")],
    );

    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).not.toHaveBeenCalled();
    expect(syncService.fullSync).not.toHaveBeenCalledWith(true);
  });

  it.each([
    ["the policy is off", [recoveryPolicy("dental", false, true)]],
    ["the policy is on without automatic enrollment", [recoveryPolicy("dental", true, false)]],
    ["the organization has no such policy", []],
    ["only another organization's policy is on", [recoveryPolicy("other")]],
  ])("does nothing when %s", async (_case, policies) => {
    const { recovery, enrollment } = setup([membership("dental")], policies);

    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).not.toHaveBeenCalled();
  });

  it.each([
    ["invited", OrganizationUserStatusType.Invited],
    ["accepted, not confirmed yet", OrganizationUserStatusType.Accepted],
    ["revoked", OrganizationUserStatusType.Revoked],
  ])("does nothing for a membership that's %s", async (_case, status) => {
    const { recovery, enrollment } = setup(
      [membership("dental", { status })],
      [recoveryPolicy("dental")],
    );

    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).not.toHaveBeenCalled();
  });

  it("sends nothing for a membership that came from an MSP, which the server never enrolls", async () => {
    const { recovery, enrollment } = setup(
      [membership("client", { keykeeperFromMsp: true })],
      [recoveryPolicy("client")],
    );

    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).not.toHaveBeenCalled();
  });

  it("does nothing where the organization doesn't offer account recovery (no email) or has no keys", async () => {
    const { recovery, enrollment } = setup(
      [
        membership("no-email", { useResetPassword: false }),
        membership("no-keys", { hasPublicAndPrivateKeys: false }),
        membership("no-policies", { usePolicies: false }),
      ],
      [recoveryPolicy("no-email"), recoveryPolicy("no-keys"), recoveryPolicy("no-policies")],
    );

    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).not.toHaveBeenCalled();
  });

  it("takes the server's refusal (an MSP's staff) quietly and doesn't try again this unlock", async () => {
    const { recovery, enrollment, syncService, logService, organizations$ } = setup(
      [membership("client")],
      [recoveryPolicy("client")],
    );
    enrollment.enroll.mockRejectedValue(mspStaffRefusal());

    const outcomes = await recovery.run(USER);

    expect(outcomes).toEqual([
      {
        organizationId: "client",
        enrolled: false,
        error: "MSP staff can't join an organization's account recovery",
      },
    ]);
    // Only in the log: nothing is shown.
    expect(logService.info).toHaveBeenCalledWith(
      expect.stringContaining("MSP staff can't join an organization's account recovery"),
    );
    expect(syncService.fullSync).not.toHaveBeenCalledWith(true);

    // A sync, or anything else that runs it again in this unlock, sends nothing.
    organizations$.next([membership("client")]);
    expect(await recovery.run(USER)).toEqual([]);
    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).toHaveBeenCalledTimes(1);
  });

  it("tries again at the next unlock after being offline", async () => {
    const { recovery, enrollment, lockAndUnlock } = setup(
      [membership("dental")],
      [recoveryPolicy("dental")],
    );
    enrollment.enroll.mockRejectedValueOnce(offline());

    const first = await recovery.run(USER);
    expect(first).toEqual([expect.objectContaining({ organizationId: "dental", enrolled: false })]);
    expect(first[0].error).toMatch(/connect|offline|internet|reach/i);
    // Not again in the same unlock.
    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).toHaveBeenCalledTimes(1);

    await lockAndUnlock();
    expect(await recovery.run(USER)).toEqual([{ organizationId: "dental", enrolled: true }]);
    expect(enrollment.enroll).toHaveBeenCalledTimes(2);
  });

  it("tries again at the next unlock after the server refused", async () => {
    const { recovery, enrollment, lockAndUnlock } = setup(
      [membership("client")],
      [recoveryPolicy("client")],
    );
    enrollment.enroll.mockRejectedValue(mspStaffRefusal());

    await recovery.run(USER);
    await lockAndUnlock();
    await recovery.run(USER);

    // Once per unlock, never more.
    expect(enrollment.enroll).toHaveBeenCalledTimes(2);
  });

  it("goes on to the other organizations when one fails, and enrolls each one only once", async () => {
    const { recovery, enrollment } = setup(
      [membership("a"), membership("b"), membership("c", { resetPasswordEnrolled: true })],
      [recoveryPolicy("a"), recoveryPolicy("b"), recoveryPolicy("c")],
    );
    enrollment.enroll.mockImplementation(async (organizationId: string) => {
      if (organizationId === "a") {
        throw offline();
      }
    });

    const outcomes = await recovery.run(USER);

    expect(outcomes.map((o) => [o.organizationId, o.enrolled])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    expect(enrollment.enroll).toHaveBeenCalledTimes(2);
  });

  it("two runs at once try once", async () => {
    const { recovery, enrollment } = setup([membership("dental")], [recoveryPolicy("dental")]);

    const [first, second] = await Promise.all([recovery.run(USER), recovery.run(USER)]);

    expect(first).toEqual([{ organizationId: "dental", enrolled: true }]);
    expect(second).toBe(first);
    expect(enrollment.enroll).toHaveBeenCalledTimes(1);
  });

  it("does nothing while locked, or for an account that isn't the active one, and keeps that unlock's try", async () => {
    const { recovery, enrollment, authStatus, activeAccount } = setup(
      [membership("dental")],
      [recoveryPolicy("dental")],
      AuthenticationStatus.Locked,
    );

    expect(await recovery.run(USER)).toEqual([]);
    activeAccount.next({ id: "someone-else" as UserId });
    authStatus.next(AuthenticationStatus.Unlocked);
    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).not.toHaveBeenCalled();

    activeAccount.next({ id: USER });
    expect(await recovery.run(USER)).toEqual([{ organizationId: "dental", enrolled: true }]);
  });

  it("with a pin (the extension) but none on this device, sends nothing at all and says why in the log", async () => {
    const pin = { pin: jest.fn().mockResolvedValue(null) };
    const { recovery, enrollment, logService } = setup(
      [membership("dental")],
      [recoveryPolicy("dental")],
      AuthenticationStatus.Unlocked,
      pin,
    );

    expect(await recovery.run(USER)).toEqual([
      { organizationId: "dental", enrolled: false, error: NO_RECOVERY_PIN },
    ]);
    expect(enrollment.enroll).not.toHaveBeenCalled();
    expect(logService.info).toHaveBeenCalledWith(expect.stringContaining(NO_RECOVERY_PIN));
    // Not asked again this unlock.
    expect(await recovery.run(USER)).toEqual([]);
    expect(pin.pin).toHaveBeenCalledTimes(1);
  });

  it("with a pin on this device, enrolls through the enrollment it was given, which checks the key", async () => {
    const pin = { pin: jest.fn().mockResolvedValue("the-install-command-fingerprint") };
    const { recovery, enrollment } = setup(
      [membership("dental")],
      [recoveryPolicy("dental")],
      AuthenticationStatus.Unlocked,
      pin,
    );

    expect(await recovery.run(USER)).toEqual([{ organizationId: "dental", enrolled: true }]);
    expect(enrollment.enroll).toHaveBeenCalledWith("dental", USER, USER_KEY);
  });

  it("logs a key that isn't the pinned one as a warning, and doesn't try again this unlock", async () => {
    const pin = { pin: jest.fn().mockResolvedValue("the-install-command-fingerprint") };
    const { recovery, enrollment, logService } = setup(
      [membership("dental")],
      [recoveryPolicy("dental")],
      AuthenticationStatus.Unlocked,
      pin,
    );
    enrollment.enroll.mockRejectedValue(new RecoveryKeyRefused("Not the install command's key."));

    expect(await recovery.run(USER)).toEqual([
      { organizationId: "dental", enrolled: false, error: "Not the install command's key." },
    ]);
    expect(logService.warning).toHaveBeenCalledWith(
      expect.stringContaining("Org dental (dental): Not the install command's key."),
    );
    expect(await recovery.run(USER)).toEqual([]);
    expect(enrollment.enroll).toHaveBeenCalledTimes(1);
  });

  it("is never more than one try per unlock, and forgets it when the account locks or signs out", () => {
    expect(KEYKEEPER_RECOVERY_TRIED.clearOn).toEqual(["lock", "logout"]);
  });
});

describe("when it runs", () => {
  it("runs at each unlock of the active account, and not while it stays unlocked", async () => {
    const { recovery, authStatus, organizations$ } = setup(
      [membership("dental")],
      [recoveryPolicy("dental")],
      AuthenticationStatus.Locked,
    );
    const run = jest.spyOn(recovery, "run").mockResolvedValue([]);
    const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

    recovery.start();
    await settled();
    expect(run).not.toHaveBeenCalled();

    authStatus.next(AuthenticationStatus.Unlocked);
    await settled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(USER);

    // Syncs and other changes while unlocked don't start it again.
    authStatus.next(AuthenticationStatus.Unlocked);
    organizations$.next([membership("dental")]);
    await settled();
    expect(run).toHaveBeenCalledTimes(1);

    authStatus.next(AuthenticationStatus.Locked);
    await settled();
    authStatus.next(AuthenticationStatus.Unlocked);
    await settled();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("who is due", () => {
  it("only a confirmed, unenrolled member, not from an MSP, where recovery is on with automatic enrollment", () => {
    const policies = [recoveryPolicy("dental")];
    expect(dueForRecovery(membership("dental"), policies)).toBe(true);
    expect(dueForRecovery(membership("dental", { resetPasswordEnrolled: true }), policies)).toBe(
      false,
    );
    expect(dueForRecovery(membership("dental", { keykeeperFromMsp: true }), policies)).toBe(false);
    expect(
      dueForRecovery(
        membership("dental", { status: OrganizationUserStatusType.Accepted }),
        policies,
      ),
    ).toBe(false);
    expect(dueForRecovery(membership("dental"), [recoveryPolicy("dental", true, false)])).toBe(
      false,
    );
    expect(dueForRecovery(membership("dental"), [recoveryPolicy("dental", false, true)])).toBe(
      false,
    );
  });

  it("owners and admins too, as accepting an invitation enrolls every role", () => {
    const policies = [recoveryPolicy("dental")];
    expect(
      dueForRecovery(membership("dental", { type: 0 } as Partial<Organization>), policies),
    ).toBe(true);
    expect(
      dueForRecovery(membership("dental", { type: 1 } as Partial<Organization>), policies),
    ).toBe(true);
  });
});
