import { TwoStepNudgeKind } from "./msp-types";
import { KeykeeperTwoStepNudge, TWO_STEP_NUDGE } from "./two-step-nudge";

// KeykeeperMspRequests.twoStepNudge answers null when the server can't be
// asked (msp-requests.spec.ts), so these stand-ins only say which nudge.
const requests = (nudge: TwoStepNudgeKind | null) => ({
  twoStepNudge: jest.fn(async () => nudge),
  dismissTwoStepNudge: jest.fn(async () => {}),
});

describe("the nudges about two-step login", () => {
  it("shows when the server says so, and Not now hides it and tells the server", async () => {
    const server = requests("setUp");
    const nudge = new KeykeeperTwoStepNudge(server);
    expect(nudge.show).toBe(false);
    expect(await nudge.load()).toBe("setUp");
    expect(nudge.show).toBe(true);
    expect(nudge.nudge).toBe("setUp");
    await nudge.notNow();
    expect(nudge.show).toBe(false);
    expect(nudge.nudge).toBeNull();
    expect(server.dismissTwoStepNudge).toHaveBeenCalledTimes(1);
  });

  it("shows the nudge to a stronger method for email codes alone, and Not now hides it the same way", async () => {
    const server = requests("stronger");
    const nudge = new KeykeeperTwoStepNudge(server);
    expect(await nudge.load()).toBe("stronger");
    expect(nudge.show).toBe(true);
    await nudge.notNow();
    expect(nudge.nudge).toBeNull();
    expect(server.dismissTwoStepNudge).toHaveBeenCalledTimes(1);
  });

  it("doesn't show when the server says no", async () => {
    const nudge = new KeykeeperTwoStepNudge(requests(null));
    expect(await nudge.load()).toBeNull();
    expect(nudge.show).toBe(false);
  });

  it("still hides it when the dismissal can't be saved", async () => {
    const server = requests("setUp");
    server.dismissTwoStepNudge.mockRejectedValueOnce(new Error("offline"));
    const nudge = new KeykeeperTwoStepNudge(server);
    await nudge.load();
    await expect(nudge.notNow()).resolves.toBeUndefined();
    expect(nudge.show).toBe(false);
  });

  it("says each nudge in its own words", () => {
    expect(TWO_STEP_NUDGE.words.setUp.text).toBe(
      "Your password is all that protects your account. Add a second step, such as an authenticator app, so a stolen password isn't enough.",
    );
    expect(TWO_STEP_NUDGE.words.stronger.text).toBe(
      "Codes by email are only as safe as your email account. An authenticator app or a security key is safer.",
    );
  });
});
