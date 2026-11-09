import { KeykeeperNewDeviceCheck } from "@bitwarden/common/auth/keykeeper/new-device-check";

import { keykeeperWaitForNewDevice, NewDeviceDeps } from "./new-device";

const check = (over: Partial<KeykeeperNewDeviceCheck> = {}): KeykeeperNewDeviceCheck => ({
  id: "c1",
  token: "the-token",
  number: "47",
  status: "waiting",
  deniedWhy: null,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  approvers: true,
  email: "later",
  emailAfter: null,
  codeSent: false,
  emailTo: null,
  ...over,
});

function deps(statuses: (KeykeeperNewDeviceCheck | null)[], over: Partial<NewDeviceDeps> = {}) {
  const lines: string[] = [];
  const d: NewDeviceDeps = {
    status: jest.fn(async () => statuses.shift() ?? null),
    sendEmail: jest.fn(async (c) => ({ ...c, codeSent: true, emailTo: "a***@example.test" })),
    write: (line) => lines.push(line),
    ask: jest.fn(async () => "1234 5678"),
    canInteract: true,
    sleep: async () => {},
    now: () => Date.now(),
    ...over,
  };
  return { d, lines };
}

describe("the CLI's new-device check", () => {
  it("prints the number, waits, and finishes with the token once approved", async () => {
    const { d, lines } = deps([check(), check({ status: "approved", token: "ignored" })]);
    expect(await keykeeperWaitForNewDevice(check(), d)).toEqual({ otp: "the-token" });
    expect(lines.join("\n")).toContain("type this number: 47");
    expect(d.status).toHaveBeenCalledTimes(2);
    expect(d.ask).not.toHaveBeenCalled();
  });

  it("stops when it's denied, saying why", async () => {
    const { d } = deps([check({ status: "denied", deniedWhy: "number" })]);
    const result = await keykeeperWaitForNewDevice(check(), d);
    expect(result).toEqual({ error: expect.stringContaining("didn't match") });
  });

  it("stops when the check has ended", async () => {
    const { d } = deps([null]);
    expect(await keykeeperWaitForNewDevice(check(), d)).toEqual({
      error: "This login has ended. Run login again.",
    });
    const late = deps([check()], { now: () => Date.now() + 700_000 });
    expect(await keykeeperWaitForNewDevice(check(), late.d)).toEqual({
      error: "This login has ended. Run login again.",
    });
  });

  it("asks for the emailed code when no device can approve", async () => {
    const { d, lines } = deps([]);
    const result = await keykeeperWaitForNewDevice(check({ approvers: false, email: "now" }), d);
    expect(d.sendEmail).toHaveBeenCalled();
    expect(lines.join("\n")).toContain("a***@example.test");
    expect(result).toEqual({ otp: "12345678" });
  });

  it("can't ask for a code where it may not prompt", async () => {
    const { d } = deps([], { canInteract: false });
    const result = await keykeeperWaitForNewDevice(check({ approvers: false, email: "now" }), d);
    expect(result).toEqual({ error: expect.stringContaining("code by email") });
    expect(d.sendEmail).not.toHaveBeenCalled();
  });
});
