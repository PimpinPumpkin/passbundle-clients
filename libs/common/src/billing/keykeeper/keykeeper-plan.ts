/**
 * Keykeeper: a plan as the server tells it, in `keykeeperPlan` on the profile
 * and on each organization in a sync, and in the answer of
 * `GET /api/keykeeper/plan` (DESIGN.md, "Plans and billing", "How a plan
 * reaches the clients"). The Plan page and the plan banners read it. Nothing
 * is enforced from it, and nothing here works out what a plan gives: the
 * server's one function does, and this only carries its answer.
 */
import { map, Observable } from "rxjs";

import { KEYKEEPER_PLAN_DISK, StateProvider, UserKeyDefinition } from "@bitwarden/state";

import { UserId } from "../../types/guid";

export type KeykeeperPlanName = "free" | "premium" | "families" | "business" | "msp";

/** What a plan is at the moment the server answered. */
export type KeykeeperPlanState = "trial" | "active" | "paymentDue" | "ended";

/** A server that doesn't enforce plans: everyone gets everything, and there's nothing to show. */
export type KeykeeperPlanNotEnforced = { enforced: false };

export type KeykeeperPlanEnforced = {
  enforced: true;
  /** "free" for a person with no plan; null for an organization or an MSP with none. */
  plan: KeykeeperPlanName | null;
  /** Null when there's no plan. */
  state: KeykeeperPlanState | null;
  /**
   * The dates, and whether it renews, are only for whoever manages the plan:
   * null for everyone else.
   */
  freeUntil: string | null;
  freeWhy: "trial" | "offer" | null;
  until: string | null;
  renews: boolean | null;
  /**
   * The last moment the plan is in effect, as the server's one function
   * decides it (piece 4 of "Build order" adds it). Null where the server
   * doesn't say: then the words leave that date out.
   */
  endsAt: string | null;
  /** Attachments, in whole GB, as the plan gives them now. Null for an MSP's pool. */
  storageGb: number | null;
  /** How many people it covers. Null: no limit. */
  people: number | null;
  /** The MSP whose pool covers this organization. */
  coveredBy: { id: string; name: string } | null;
  /** Whether the person asking may manage it. */
  canManage: boolean;
  /**
   * Whether the person asking can open the provider's page for it: true only
   * where a provider is set and they may manage it (piece 8 of "Build order"
   * adds it). Absent or false: there's no button.
   */
  canPay: boolean;
};

export type KeykeeperPlan = KeykeeperPlanNotEnforced | KeykeeperPlanEnforced;

export const KEYKEEPER_PLAN_NOT_ENFORCED: KeykeeperPlanNotEnforced = Object.freeze({
  enforced: false,
});

const NAMES: readonly KeykeeperPlanName[] = ["free", "premium", "families", "business", "msp"];
const STATES: readonly KeykeeperPlanState[] = ["trial", "active", "paymentDue", "ended"];

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  values.includes(value as T) ? (value as T) : null;

/** A date the server sent, or null for anything that isn't one. */
function dateOrNull(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function wholeOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function coveredByOrNull(value: unknown): { id: string; name: string } | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  const { id, name } = value as { id?: unknown; name?: unknown };
  return typeof id === "string" && typeof name === "string" ? { id, name } : null;
}

/**
 * `keykeeperPlan` as the server sent it, or "not enforced" for anything
 * else: a server that doesn't send it, says it doesn't enforce plans, or
 * sends something this code doesn't understand shows no Plan page and no
 * banners, as before plans existed.
 */
export function keykeeperPlanFrom(value: unknown): KeykeeperPlan {
  if (
    value == null ||
    typeof value !== "object" ||
    (value as { enforced?: unknown }).enforced !== true
  ) {
    return KEYKEEPER_PLAN_NOT_ENFORCED;
  }
  const v = value as Record<string, unknown>;
  return {
    enforced: true,
    plan: oneOf(NAMES, v.plan),
    state: oneOf(STATES, v.state),
    freeUntil: dateOrNull(v.freeUntil),
    freeWhy: oneOf(["trial", "offer"] as const, v.freeWhy),
    until: dateOrNull(v.until),
    renews: typeof v.renews === "boolean" ? v.renews : null,
    endsAt: dateOrNull(v.endsAt),
    storageGb: wholeOrNull(v.storageGb),
    people: wholeOrNull(v.people),
    coveredBy: coveredByOrNull(v.coveredBy),
    canManage: v.canManage === true,
    canPay: v.canPay === true,
  };
}

/** A person's own plan, as their last sync told it. */
export const KEYKEEPER_OWN_PLAN = new UserKeyDefinition<KeykeeperPlan>(
  KEYKEEPER_PLAN_DISK,
  "ownPlan",
  {
    deserializer: (value) => keykeeperPlanFrom(value),
    clearOn: ["logout"],
  },
);

/** A person's own plan as their last sync told it: not enforced until a sync has said. */
export function ownPlan$(stateProvider: StateProvider, userId: UserId): Observable<KeykeeperPlan> {
  return stateProvider
    .getUser(userId, KEYKEEPER_OWN_PLAN)
    .state$.pipe(
      map((plan) => (plan == null ? KEYKEEPER_PLAN_NOT_ENFORCED : keykeeperPlanFrom(plan))),
    );
}
