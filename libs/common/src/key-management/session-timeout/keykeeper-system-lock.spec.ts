import {
  VaultTimeoutNumberType,
  VaultTimeoutStringType,
} from "../vault-timeout/types/vault-timeout.type";

import { SessionTimeoutTypeService } from "./abstractions/session-timeout-type.service";
import {
  keykeeperIsWebCap,
  keykeeperPolicyForClient,
  keykeeperSystemLockMessage,
  keykeeperWaitLabel,
  keykeeperWebMinutes,
  keykeeperWebSystemLockMinutes,
  keykeeperWebSystemLockOffers,
  keykeeperWebSystemLockTimeout,
} from "./keykeeper-system-lock";
import { MaximumSessionTimeoutPolicyData } from "./types/maximum-session-timeout-policy.type";

const web = { keykeeperSystemLockIsWait: true } as SessionTimeoutTypeService;
const extension = {} as SessionTimeoutTypeService;
const policy = (data: Partial<MaximumSessionTimeoutPolicyData>) =>
  ({ minutes: null, ...data }) as unknown as MaximumSessionTimeoutPolicyData;

describe("Keykeeper: when the computer locks, in the web vault", () => {
  it("is a longest wait of webMinutes, with the policy's action", () => {
    expect(
      keykeeperPolicyForClient(
        policy({ type: "onSystemLock", webMinutes: 60, action: "logOut" }),
        web,
      ),
    ).toEqual({ type: "custom", minutes: 60, action: "logOut" });
    expect(keykeeperPolicyForClient(policy({ type: "onSystemLock", webMinutes: 1 }), web)).toEqual({
      type: "custom",
      minutes: 1,
      action: undefined,
    });
  });

  it("is 15 minutes when the policy doesn't say, or says something unreadable", () => {
    for (const webMinutes of [undefined, null, 0, 1441, 2.5, "30"]) {
      expect(
        keykeeperWebMinutes(policy({ type: "onSystemLock", webMinutes: webMinutes as any })),
      ).toBe(15);
    }
    expect(keykeeperPolicyForClient(policy({ type: "onSystemLock" }), web)).toEqual({
      type: "custom",
      minutes: 15,
      action: undefined,
    });
  });

  it("leaves every other policy, and no policy, as it is", () => {
    for (const data of [
      policy({ type: "custom", minutes: 30 }),
      policy({ type: null, minutes: 30 }),
      policy({ type: "immediately" }),
      policy({ type: "onAppRestart" }),
      policy({ type: "never" }),
    ]) {
      expect(keykeeperPolicyForClient(data, web)).toBe(data);
    }
    expect(keykeeperPolicyForClient(null, web)).toBeNull();
  });

  it("leaves it alone in clients that see the computer lock, which ignore webMinutes", () => {
    const data = policy({ type: "onSystemLock", webMinutes: 5 });
    expect(keykeeperPolicyForClient(data, extension)).toBe(data);
  });

  it("says what it does in Settings", () => {
    expect(keykeeperSystemLockMessage(policy({ type: "onSystemLock" }))).toBe(
      "Your organization locks vaults when the computer locks. A web page can't tell when that " +
        "happens, so here the timeout is at most 15 minutes, or On browser refresh.",
    );
    expect(keykeeperSystemLockMessage(policy({ type: "onSystemLock", webMinutes: 90 }))).toContain(
      "at most 1 hour 30 minutes,",
    );
  });

  it("applies only in the web vault, to that policy", () => {
    expect(
      keykeeperWebSystemLockMinutes(policy({ type: "onSystemLock", webMinutes: 5 }), web),
    ).toBe(5);
    expect(keykeeperWebSystemLockMinutes(policy({ type: "onSystemLock" }), web)).toBe(15);
    expect(keykeeperWebSystemLockMinutes(policy({ type: "onSystemLock" }), extension)).toBeNull();
    expect(keykeeperWebSystemLockMinutes(policy({ type: "custom", minutes: 5 }), web)).toBeNull();
    expect(keykeeperWebSystemLockMinutes(null, web)).toBeNull();
  });

  it("caps a timeout in minutes, and keeps On browser refresh as the person chose it", () => {
    expect(keykeeperWebSystemLockTimeout(60, 15)).toBe(15);
    expect(keykeeperWebSystemLockTimeout(5, 15)).toBe(5);
    expect(keykeeperWebSystemLockTimeout(VaultTimeoutNumberType.Immediately, 15)).toBe(0);
    expect(keykeeperWebSystemLockTimeout(VaultTimeoutStringType.OnRestart, 15)).toBe(
      VaultTimeoutStringType.OnRestart,
    );
    // What the web can't keep locks at each reload.
    for (const timeout of [
      VaultTimeoutStringType.Never,
      VaultTimeoutStringType.OnLocked,
      VaultTimeoutStringType.OnIdle,
      VaultTimeoutStringType.OnSleep,
    ]) {
      expect(keykeeperWebSystemLockTimeout(timeout, 15)).toBe(VaultTimeoutStringType.OnRestart);
    }
  });

  it("leaves the stored choice alone when only the cap differs", () => {
    expect(keykeeperIsWebCap(60, 15, 15)).toBe(true);
    expect(keykeeperIsWebCap(null, 15, 15)).toBe(true);
    // A choice the web can't keep is written as what applies.
    expect(
      keykeeperIsWebCap(VaultTimeoutStringType.Never, VaultTimeoutStringType.OnRestart, 15),
    ).toBe(false);
    // No such policy: upstream's own rules.
    expect(keykeeperIsWebCap(60, 15, null)).toBe(false);
  });

  it("offers the waits up to the cap, Custom, and On browser refresh", () => {
    const offered = [0, 1, 5, 15, 30, 60, 240, "onRestart", "custom", "never", "onLocked"].filter(
      (t) => keykeeperWebSystemLockOffers(t as any, 15),
    );
    expect(offered).toEqual([0, 1, 5, 15, "onRestart", "custom"]);
  });

  it("says each wait as a person would", () => {
    expect([1, 5, 60, 90, 240, 1440].map(keykeeperWaitLabel)).toEqual([
      "1 minute",
      "5 minutes",
      "1 hour",
      "1 hour 30 minutes",
      "4 hours",
      "1 day",
    ]);
  });
});
