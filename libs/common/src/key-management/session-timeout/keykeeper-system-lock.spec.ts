import { SessionTimeoutTypeService } from "./abstractions/session-timeout-type.service";
import {
  keykeeperPolicyForClient,
  keykeeperSystemLockMessage,
  keykeeperWaitLabel,
  keykeeperWebMinutes,
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
        "happens, so the web vault locks after 15 minutes without use, and 2 minutes after the " +
        "browser closes.",
    );
    expect(keykeeperSystemLockMessage(policy({ type: "onSystemLock", webMinutes: 90 }))).toContain(
      "after 1 hour 30 minutes without use",
    );
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
