// Keykeeper: the extension locks when the computer locks, for a timeout of
// "on system lock" (upstream) and, under a "when the computer locks" policy,
// whatever timeout the person picked. See docs/core.md, "Locking by policy".
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { LockService, LogoutService } from "@bitwarden/auth/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import {
  VaultTimeout,
  VaultTimeoutAction,
  VaultTimeoutService,
  VaultTimeoutSettingsService,
  VaultTimeoutStringType,
} from "@bitwarden/common/key-management/vault-timeout";
import { ServerNotificationsService } from "@bitwarden/common/platform/server-notifications";
import { UserId } from "@bitwarden/user-core";

import IdleBackground from "./idle.background";

const USER = "user-1" as UserId;

describe("IdleBackground", () => {
  let listeners: Array<(state: string) => Promise<void> | void>;
  let lockService: ReturnType<typeof mock<LockService>>;
  let logoutService: ReturnType<typeof mock<LogoutService>>;
  let settings: ReturnType<typeof mock<VaultTimeoutSettingsService>>;

  function start(
    timeout: VaultTimeout,
    policyLocks: boolean,
    action: VaultTimeoutAction = VaultTimeoutAction.Lock,
  ) {
    listeners = [];
    (chrome as any).idle = {
      onStateChanged: { addListener: (l: (state: string) => void) => listeners.push(l) },
      setDetectionInterval: jest.fn(),
      queryState: jest.fn(),
    };
    lockService = mock<LockService>();
    logoutService = mock<LogoutService>();
    settings = mock<VaultTimeoutSettingsService>();
    settings.isVaultTimeoutSuppressed.mockResolvedValue(false);
    settings.getVaultTimeoutByUserId$.mockReturnValue(of(timeout));
    settings.getVaultTimeoutActionByUserId$.mockReturnValue(of(action));
    settings.keykeeperLocksOnSystemLock$.mockReturnValue(of(policyLocks));
    const accountService = mock<AccountService>();
    (accountService as any).accounts$ = of({ [USER]: {} });

    new IdleBackground(
      mock<VaultTimeoutService>(),
      mock<ServerNotificationsService>(),
      accountService,
      settings,
      lockService,
      logoutService,
    ).init();
  }

  async function computerLocks() {
    for (const listener of listeners) {
      await listener("locked");
    }
  }

  afterEach(() => {
    delete (chrome as any).idle;
  });

  it("locks a timeout of on system lock, as upstream does", async () => {
    start(VaultTimeoutStringType.OnLocked, false);
    await computerLocks();
    expect(lockService.lock).toHaveBeenCalledWith(USER);
  });

  it("leaves a timeout in minutes alone without the policy", async () => {
    start(15, false);
    await computerLocks();
    expect(lockService.lock).not.toHaveBeenCalled();
    expect(logoutService.logout).not.toHaveBeenCalled();
  });

  it("locks a timeout in minutes when a policy says to lock with the computer", async () => {
    start(15, true);
    await computerLocks();
    expect(lockService.lock).toHaveBeenCalledWith(USER);
  });

  it("signs out instead when that's the action", async () => {
    start(30, true, VaultTimeoutAction.LogOut);
    await computerLocks();
    expect(logoutService.logout).toHaveBeenCalledWith(USER, "vaultTimeout");
    expect(lockService.lock).not.toHaveBeenCalled();
  });

  it("does nothing for idle or active, only for locked", async () => {
    start(15, true);
    for (const listener of listeners) {
      await listener("idle");
      await listener("active");
    }
    expect(lockService.lock).not.toHaveBeenCalled();
  });
});
