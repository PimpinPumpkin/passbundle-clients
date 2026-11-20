// Keykeeper: an MSP signing up by itself (DESIGN.md, "MSP console", "Getting
// there"). The website's MSP page links to /#/set-up-msp, which says only that
// this person wants to set up an MSP. Someone signed out goes on to sign up
// (or to sign in, from there), and this browser remembers why they came, so
// the first time their vault would open after that, the MSP console's own
// "Set up your MSP" step opens instead. The server's MSP_SIGNUPS_ALLOWED still
// decides whether they may.

import { MspSummary } from "@bitwarden/admin-console/common";

const KEY = "keykeeperSetUpMsp";

/**
 * How long this browser remembers it: long enough to sign up through the
 * emailed link (good for 30 minutes) or to sign in, short enough that someone
 * else signing in on this computer another day isn't sent there.
 */
export const SET_UP_MSP_FOR_MS = 24 * 60 * 60 * 1000;

/** What the console says where Create MSP would be, on a server that doesn't allow it (the server's own words). */
export const SET_UP_REFUSED =
  "This server doesn't allow setting up an MSP. Ask the person who runs it.";

/**
 * Remembers in this browser that the person came to set up an MSP, with when.
 * Storage can be missing or refuse (a private window, blocked site data);
 * then their vault opens as usual, and the menu still has the way there.
 */
export function rememberSetUpMsp(storage: Storage | null | undefined, now: number) {
  try {
    storage?.setItem(KEY, String(now));
  } catch {
    // Not remembered.
  }
}

/**
 * Whether the person came to set up an MSP, within the last day; once. It's
 * forgotten whatever the answer, so it never sends anyone there twice.
 */
export function takeSetUpMsp(storage: Storage | null | undefined, now: number): boolean {
  let value: string | null | undefined;
  try {
    value = storage?.getItem(KEY);
    if (value != null) {
      storage?.removeItem(KEY);
    }
  } catch {
    return false;
  }
  if (value == null || !/^\d{1,16}$/.test(value)) {
    return false;
  }
  const age = now - Number(value);
  // A minute's slack for a clock that moved back since.
  return age > -60_000 && age <= SET_UP_MSP_FOR_MS;
}

/**
 * The MSPs the person is staff of, and whether this server lets them set one
 * up, from the server's answer to GET /keykeeper/msp. A server that doesn't
 * say (one from before it did) is taken to allow it: Create MSP then gets the
 * server's own answer.
 */
export function readMspList(answer: { data?: MspSummary[]; setUpAllowed?: unknown } | null): {
  msps: MspSummary[];
  setUpAllowed: boolean;
} {
  return { msps: answer?.data ?? [], setUpAllowed: answer?.setUpAllowed !== false };
}
