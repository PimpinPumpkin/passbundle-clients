// Keykeeper: "when the computer locks" where the computer lock can't be seen.
//
// The Vault lock policy (upstream's vault timeout policy, type 9) can say
// `onSystemLock`. A web page can't tell when the computer locks, and upstream
// turns that into "on browser refresh" there, which locks on every reload and
// never while the page stays open. In the web vault it means a longest wait
// instead: the policy's `webMinutes` (15 when it's missing), checked by the
// server from 1 minute to a day. Everything else (the browser extension and
// our apps) keeps the real computer lock and ignores `webMinutes`.
//
// Applied where upstream reads the policy, so its own code treats the policy
// as a longest wait ("custom") from there. See docs/core.md, "Locking by
// policy", in the meta repo.
import { SessionTimeoutTypeService } from "./abstractions/session-timeout-type.service";
import { MaximumSessionTimeoutPolicyData } from "./types/maximum-session-timeout-policy.type";

/** The web vault's wait under "when the computer locks" when the policy doesn't say. */
export const KEYKEEPER_WEB_MINUTES_DEFAULT = 15;

/** The web vault's wait in a "when the computer locks" policy, in minutes. */
export function keykeeperWebMinutes(policy: MaximumSessionTimeoutPolicyData): number {
  const minutes = policy.webMinutes;
  return typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 && minutes <= 1440
    ? minutes
    : KEYKEEPER_WEB_MINUTES_DEFAULT;
}

/** Whether this client reads "when the computer locks" as a longest wait. */
export function keykeeperSystemLockIsWait(service: SessionTimeoutTypeService): boolean {
  return service.keykeeperSystemLockIsWait === true;
}

/**
 * The policy as this client applies it: in the web vault, "when the computer
 * locks" becomes a longest wait of `webMinutes`, with the same action.
 * Anything else, or any other client, gets the policy as it is.
 */
export function keykeeperPolicyForClient(
  policy: MaximumSessionTimeoutPolicyData | null,
  service: SessionTimeoutTypeService,
): MaximumSessionTimeoutPolicyData | null {
  if (policy?.type !== "onSystemLock" || !keykeeperSystemLockIsWait(service)) {
    return policy;
  }
  return { type: "custom", minutes: keykeeperWebMinutes(policy), action: policy.action };
}

/** A wait as people say it: "15 minutes", "4 hours", "1 hour 30 minutes", "1 day". */
export function keykeeperWaitLabel(minutes: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes === 1440) {
    return "1 day";
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return plural(rest, "minute");
  }
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}

/**
 * What Settings says under the timeout when a "when the computer locks"
 * policy applies in the web vault, in place of upstream's line, which named
 * "On browser refresh".
 */
export function keykeeperSystemLockMessage(policy: MaximumSessionTimeoutPolicyData): string {
  return (
    "Your organization locks vaults when the computer locks. A web page can't tell when " +
    `that happens, so the web vault locks after ${keykeeperWaitLabel(keykeeperWebMinutes(policy))} ` +
    "without use, and 2 minutes after the browser closes."
  );
}
