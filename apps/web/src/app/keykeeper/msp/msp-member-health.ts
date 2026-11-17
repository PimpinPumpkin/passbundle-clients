// Keykeeper: "Members' own passwords" in the MSP console (DESIGN.md,
// "Members' own passwords"). For each client the person manages (a client
// they reach where they're a confirmed owner or admin), the server's MSP
// route (GET /keykeeper/msp/<id>/member-health) sends its members' numbers as
// the client's own owners and admins see them in its Reports, by membership
// id: never which items, never the MSP's own people's numbers, and nobody's
// for a client with the setting off. The console adds them up on the clients
// list and names each member on the client's panel.

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import { MemberHealthReport, memberHealthTotals } from "../health/member-health";

/** One client, as the server's MSP route sends it. */
export type MspMemberHealthClient = {
  organizationId: string;
  /** The client has "Members' own passwords" on. Off, `members` is empty. */
  on: boolean;
  /** Each of its own confirmed members' numbers; all null until their apps report. */
  members: MemberHealthReport[];
};

/**
 * The clients whose members' numbers the person sees, by client id. Null
 * from a server without the route (404 or 405), where the console shows
 * nothing of it.
 */
export async function getMspMemberHealth(
  apiService: ApiService,
  mspId: string,
): Promise<Map<string, MspMemberHealthClient> | null> {
  try {
    const response: { data?: MspMemberHealthClient[] } = await apiService.send(
      "GET",
      `/keykeeper/msp/${encodeURIComponent(mspId)}/member-health`,
      null,
      true,
      true,
    );
    return new Map((response?.data ?? []).map((client) => [client.organizationId, client]));
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 405) {
      return null;
    }
    throw e;
  }
}

/**
 * A client's line on the clients list: its members' numbers added up, that
 * it's off, or that nobody has reported yet. Null where the person doesn't
 * see them. Exposed is left out while nobody's apps have checked breaches,
 * and has a "+" while only some have.
 */
export function ownHealthLine(client: MspMemberHealthClient | undefined): string | null {
  if (client == null) {
    return null;
  }
  if (!client.on) {
    return "Members' own passwords: off";
  }
  const totals = memberHealthTotals(client.members);
  if (totals.reported === 0) {
    return "Members' own passwords: none reported yet";
  }
  const numbers = [`${totals.weak} weak`, `${totals.reused} reused`];
  if (totals.exposedUnchecked < totals.reported) {
    const some = totals.exposedUnchecked > 0 ? "+" : "";
    numbers.push(`${totals.exposed}${some} exposed`);
  }
  return `Members' own passwords: ${numbers.join(", ")}`;
}

/** The panel's summary: who reported, and their numbers added up. */
export function ownHealthSummary(members: MemberHealthReport[]): string {
  const totals = memberHealthTotals(members);
  if (totals.members === 0) {
    return "No members of its own yet.";
  }
  const who =
    totals.members === 1
      ? `${totals.reported} of 1 member reported.`
      : `${totals.reported} of ${totals.members} members reported.`;
  if (totals.reported === 0) {
    return who;
  }
  return `${who} In their own items: ${totals.weak} weak and ${totals.reused} reused passwords.`;
}
