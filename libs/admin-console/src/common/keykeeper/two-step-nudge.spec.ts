import { KeykeeperTwoStepNudge } from "./two-step-nudge";

// KeykeeperMspRequests.twoStepNudge answers false when the server can't be
// asked (msp-requests.spec.ts), so these stand-ins only say yes or no.
const requests = (show: boolean) => ({
  twoStepNudge: jest.fn(async () => show),
  dismissTwoStepNudge: jest.fn(async () => {}),
});

describe("the nudge to set up two-step login", () => {
  it("shows when the server says so, and Not now hides it and tells the server", async () => {
    const server = requests(true);
    const nudge = new KeykeeperTwoStepNudge(server);
    expect(nudge.show).toBe(false);
    expect(await nudge.load()).toBe(true);
    expect(nudge.show).toBe(true);
    await nudge.notNow();
    expect(nudge.show).toBe(false);
    expect(server.dismissTwoStepNudge).toHaveBeenCalledTimes(1);
  });

  it("doesn't show when the server says no", async () => {
    const nudge = new KeykeeperTwoStepNudge(requests(false));
    expect(await nudge.load()).toBe(false);
    expect(nudge.show).toBe(false);
  });

  it("still hides it when the dismissal can't be saved", async () => {
    const server = requests(true);
    server.dismissTwoStepNudge.mockRejectedValueOnce(new Error("offline"));
    const nudge = new KeykeeperTwoStepNudge(server);
    await nudge.load();
    await expect(nudge.notNow()).resolves.toBeUndefined();
    expect(nudge.show).toBe(false);
  });
});
