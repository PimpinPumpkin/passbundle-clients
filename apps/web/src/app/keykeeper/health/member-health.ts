// Keykeeper: the admin view of members' own passwords (DESIGN.md, "Members'
// own passwords"): the numbers each member's apps reported about the logins
// in their Personal items, by member, named from the member list the admin
// console loads. Numbers only, never which items.

/** One member's numbers as the server sends them; all null until their apps report. */
export type MemberHealthReport = {
  memberId: string;
  logins: number | null;
  weak: number | null;
  reused: number | null;
  /** Null when no app of theirs has checked breaches. */
  exposed: number | null;
  exposedCheckedAt: string | null;
  reportedAt: string | null;
};

/** A member as the member list has them. */
export type MemberName = { id: string; name?: string | null; email: string };

export type MemberHealthRow = MemberHealthReport & {
  name: string;
  email: string;
  /** Weak, reused, and exposed together, to sort by. */
  problems: number;
};

/**
 * The page's rows: each member the server reported on, named, most to fix
 * first, then those not reported yet, by name. Someone the member list
 * doesn't have (they left since) is left out.
 */
export function memberHealthRows(
  reports: MemberHealthReport[],
  members: MemberName[],
): MemberHealthRow[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const rows: MemberHealthRow[] = [];
  for (const report of reports) {
    const member = byId.get(report.memberId);
    if (member == null) {
      continue;
    }
    rows.push({
      ...report,
      name: member.name || member.email,
      email: member.email,
      problems: (report.weak ?? 0) + (report.reused ?? 0) + (report.exposed ?? 0),
    });
  }
  const byName = (a: MemberHealthRow, b: MemberHealthRow) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return rows.sort((a, b) => {
    const aReported = a.reportedAt != null;
    const bReported = b.reportedAt != null;
    if (aReported !== bReported) {
      return aReported ? -1 : 1;
    }
    return b.problems - a.problems || byName(a, b);
  });
}

/** The page's totals: members who reported, and their numbers added up. */
export function memberHealthTotals(rows: MemberHealthRow[]) {
  const reported = rows.filter((r) => r.reportedAt != null);
  const sum = (key: "logins" | "weak" | "reused") =>
    reported.reduce((total, r) => total + (r[key] ?? 0), 0);
  return {
    members: rows.length,
    reported: reported.length,
    logins: sum("logins"),
    weak: sum("weak"),
    reused: sum("reused"),
    exposed: reported.reduce((total, r) => total + (r.exposed ?? 0), 0),
    exposedUnchecked: reported.filter((r) => r.exposed == null).length,
  };
}
