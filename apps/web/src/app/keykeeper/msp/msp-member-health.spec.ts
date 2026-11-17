import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import { MemberHealthReport } from "../health/member-health";

import {
  getMspMemberHealth,
  MspMemberHealthClient,
  ownHealthLine,
  ownHealthSummary,
} from "./msp-member-health";

const report = (memberId: string, numbers: Partial<MemberHealthReport> = {}) => ({
  memberId,
  logins: null,
  weak: null,
  reused: null,
  exposed: null,
  exposedCheckedAt: null,
  reportedAt: null,
  ...numbers,
});
const reported = (memberId: string, weak: number, reused: number, exposed: number | null) =>
  report(memberId, { logins: 20, weak, reused, exposed, reportedAt: "2026-11-07T10:00:00.000Z" });
const client = (on: boolean, members: MemberHealthReport[] = []): MspMemberHealthClient => ({
  organizationId: "contoso",
  on,
  members,
});

describe("members' own passwords in the MSP console", () => {
  it("adds up a client's members' numbers for the clients list", () => {
    expect(
      ownHealthLine(
        client(true, [reported("ana", 1, 2, 1), reported("ben", 2, 2, 0), report("cy")]),
      ),
    ).toBe("Members' own passwords: 3 weak, 4 reused, 1 exposed");
  });

  it("says when a client has it off, and when nobody has reported", () => {
    expect(ownHealthLine(client(false))).toBe("Members' own passwords: off");
    expect(ownHealthLine(client(true, [report("ana"), report("ben")]))).toBe(
      "Members' own passwords: none reported yet",
    );
    expect(ownHealthLine(client(true))).toBe("Members' own passwords: none reported yet");
  });

  it("says nothing for a client the person doesn't manage", () => {
    expect(ownHealthLine(undefined)).toBeNull();
  });

  it("leaves exposed out until someone's apps check breaches, and marks it while only some have", () => {
    expect(ownHealthLine(client(true, [reported("ana", 1, 2, null)]))).toBe(
      "Members' own passwords: 1 weak, 2 reused",
    );
    expect(
      ownHealthLine(client(true, [reported("ana", 1, 2, null), reported("ben", 0, 0, 3)])),
    ).toBe("Members' own passwords: 1 weak, 2 reused, 3+ exposed");
  });

  it("sums up who reported on the client's panel", () => {
    expect(ownHealthSummary([reported("ana", 1, 2, 1), report("ben")])).toBe(
      "1 of 2 members reported. In their own items: 1 weak and 2 reused passwords.",
    );
    expect(ownHealthSummary([report("ana")])).toBe("0 of 1 member reported.");
    expect(ownHealthSummary([])).toBe("No members of its own yet.");
  });

  it("asks the MSP's route, and shows nothing of it on a server without it", async () => {
    const api = mock<ApiService>();
    api.send.mockResolvedValue({
      data: [
        client(true, [reported("ana", 1, 2, 1)]),
        { ...client(false), organizationId: "fabrikam" },
      ],
    });
    const seen = await getMspMemberHealth(api, "msp-1");
    expect(api.send).toHaveBeenCalledWith(
      "GET",
      "/keykeeper/msp/msp-1/member-health",
      null,
      true,
      true,
    );
    expect([...seen!.keys()]).toEqual(["contoso", "fabrikam"]);
    expect(seen!.get("fabrikam")!.on).toBe(false);

    for (const statusCode of [404, 405]) {
      api.send.mockRejectedValue({ statusCode });
      await expect(getMspMemberHealth(api, "msp-1")).resolves.toBeNull();
    }
    api.send.mockRejectedValue({ statusCode: 500 });
    await expect(getMspMemberHealth(api, "msp-1")).rejects.toEqual({ statusCode: 500 });
  });
});
