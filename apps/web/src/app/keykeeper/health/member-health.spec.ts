import { MemberHealthReport, memberHealthRows, memberHealthTotals } from "./member-health";

const report = (
  memberId: string,
  numbers: Partial<MemberHealthReport> = {},
): MemberHealthReport => ({
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
  report(memberId, {
    logins: 20,
    weak,
    reused,
    exposed,
    reportedAt: "2026-11-07T10:00:00.000Z",
  });

const members = [
  { id: "ana", name: "Ana", email: "ana@example.test" },
  { id: "ben", name: "", email: "ben@example.test" },
  { id: "cy", name: "Cy", email: "cy@example.test" },
  { id: "di", name: "Di", email: "di@example.test" },
];

describe("members' own passwords", () => {
  it("names each member, most to fix first, then those not reported yet", () => {
    const rows = memberHealthRows(
      [
        report("di"),
        reported("ana", 1, 0, 0),
        reported("ben", 2, 2, null),
        reported("cy", 0, 1, 0),
      ],
      members,
    );

    expect(rows.map((r) => [r.name, r.problems])).toEqual([
      ["ben@example.test", 4],
      ["Ana", 1],
      ["Cy", 1],
      ["Di", 0],
    ]);
  });

  it("leaves out anyone the member list doesn't have", () => {
    expect(memberHealthRows([reported("gone", 3, 3, 3)], members)).toEqual([]);
  });

  it("adds up who reported and their numbers, and how many didn't check breaches", () => {
    const totals = memberHealthTotals(
      memberHealthRows(
        [report("di"), reported("ana", 1, 0, 2), reported("ben", 2, 2, null)],
        members,
      ),
    );
    expect(totals).toEqual({
      members: 3,
      reported: 2,
      logins: 40,
      weak: 3,
      reused: 2,
      exposed: 2,
      exposedUnchecked: 1,
    });
  });
});
