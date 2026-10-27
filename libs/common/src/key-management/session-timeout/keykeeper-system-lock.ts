// Keykeeper: "when the computer locks" where the computer lock can't be seen.
//
// The Vault lock policy (upstream's vault timeout policy, type 9) can say
// `onSystemLock`. A web page can't tell when the computer locks, and upstream
// turns that into "on browser refresh" there, which locks on every reload and
// never while the page stays open. In the web vault it caps the timeout
// instead: at most the policy's `webMinutes` (15 when it's missing), checked by
// the server from 1 minute to a day. "On browser refresh" stays a choice, and
// keeps meaning a lock at every reload. Nothing rewrites the person's own
// choice to fit: the cap applies where the timeout is read, so leaving the
// organization leaves their choice as it was. Everything else (the browser
// extension and our apps) keeps the real computer lock and ignores
// `webMinutes`. See docs/core.md, "Locking by policy", in the meta repo.
import {
  isVaultTimeoutTypeNumeric,
  VaultTimeout,
  VaultTimeoutNumberType,
  VaultTimeoutStringType,
} from "../vault-timeout/types/vault-timeout.type";

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
 * The longest wait a "when the computer locks" policy allows in the web vault,
 * in minutes, or null where it doesn't apply: another policy, no policy, or a
 * client that sees the computer lock.
 */
export function keykeeperWebSystemLockMinutes(
  policy: MaximumSessionTimeoutPolicyData | null,
  service: SessionTimeoutTypeService,
): number | null {
  return policy?.type === "onSystemLock" && keykeeperSystemLockIsWait(service)
    ? keykeeperWebMinutes(policy)
    : null;
}

/**
 * The web vault's timeout under a "when the computer locks" policy: a number
 * of minutes at most `webMinutes`, or "On browser refresh". Choices the web
 * can't keep (Never, which only development builds offer, and the computer
 * lock, idle, and sleep) lock at each reload.
 */
export function keykeeperWebSystemLockTimeout(
  current: VaultTimeout,
  webMinutes: number,
): VaultTimeout {
  if (current === VaultTimeoutNumberType.Immediately) {
    return current;
  }
  if (isVaultTimeoutTypeNumeric(current)) {
    return Math.min(current as number, webMinutes);
  }
  return VaultTimeoutStringType.OnRestart;
}

/**
 * Whether a timeout read under the web's "when the computer locks" policy
 * differs from the stored one only by the cap. Then the stored choice stays
 * as it is, so it comes back if the policy goes.
 */
export function keykeeperIsWebCap(
  stored: VaultTimeout | null,
  applied: VaultTimeout,
  webMinutes: number | null,
): boolean {
  return (
    webMinutes != null &&
    isVaultTimeoutTypeNumeric(applied) &&
    (stored == null || isVaultTimeoutTypeNumeric(stored))
  );
}

/** The timeouts Settings offers under the web's "when the computer locks" policy. */
export function keykeeperWebSystemLockOffers(timeout: VaultTimeout, webMinutes: number): boolean {
  return (
    (isVaultTimeoutTypeNumeric(timeout) && (timeout as number) <= webMinutes) ||
    timeout === VaultTimeoutStringType.Custom ||
    timeout === VaultTimeoutStringType.OnRestart
  );
}

/**
 * The policy as Settings checks a custom timeout against: in the web vault,
 * "when the computer locks" is a longest wait of `webMinutes`, with the same
 * action. Anything else, or any other client, gets the policy as it is.
 */
export function keykeeperPolicyForClient(
  policy: MaximumSessionTimeoutPolicyData | null,
  service: SessionTimeoutTypeService,
): MaximumSessionTimeoutPolicyData | null {
  const webMinutes = keykeeperWebSystemLockMinutes(policy, service);
  if (webMinutes == null) {
    return policy;
  }
  return { type: "custom", minutes: webMinutes, action: policy?.action };
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
    `that happens, so here the timeout is at most ${keykeeperWaitLabel(keykeeperWebMinutes(policy))}, ` +
    "or On browser refresh."
  );
}
