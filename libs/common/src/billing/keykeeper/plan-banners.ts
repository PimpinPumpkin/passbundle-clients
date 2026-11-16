/**
 * Keykeeper: which plan banners someone sees, and what each says (DESIGN.md,
 * "Plans and billing", "What happens when payment stops"), from
 * `keykeeperPlan` only:
 *
 * - to whoever manages a plan, from 7 days before its trial (or a free
 *   offer) ends;
 * - to whoever pays, while a payment is due;
 * - to an organization's owners and admins, once its plan has ended.
 *
 * A client of an MSP gets no trial or payment banner of its own: the pool is
 * the MSP's admins' to pay for, and they see it in the MSP console. Each
 * banner can be put away for the rest of the day.
 */
import { KEYKEEPER_PLAN_DISK, UserKeyDefinition } from "@bitwarden/state";

import { KeykeeperPlan, KeykeeperPlanEnforced } from "./keykeeper-plan";
import { DateInWords, PlanWhose, Translate } from "./plan-words";

/** How long before a trial or a free offer ends its banner shows. */
export const TRIAL_BANNER_DAYS = 7;

const DAY = 86_400_000;

export type KeykeeperPlanBannerKind = "trialEnding" | "paymentDue" | "ended";

export type KeykeeperPlanBanner = {
  kind: KeykeeperPlanBannerKind;
  whose: PlanWhose;
  plan: KeykeeperPlanEnforced;
  /** Whether the person can open the Plan page it's about, which the banner then links to. */
  planPage: boolean;
  /** The same for the same banner all day, for putting it away. */
  key: string;
};

/** An organization as someone's sync has it, with their role in it. */
export type PlanBannerOrganization = {
  id: string;
  name: string;
  plan: KeykeeperPlan;
  isOwner: boolean;
  isAdmin: boolean;
};

/**
 * Whether someone has an organization's Plan page: its owners do, and whoever
 * manages its plan (for a client of an MSP, the MSP's admins), where plans
 * are enforced.
 */
export function organizationPlanPage(plan: KeykeeperPlan, isOwner: boolean): boolean {
  return plan.enforced && (isOwner || plan.canManage);
}

function keyOf(kind: KeykeeperPlanBannerKind, whose: PlanWhose): string {
  return whose.kind === "person" ? `${kind}:person` : `${kind}:${whose.kind}:${whose.id}`;
}

/** The banner one plan gets, if any. */
function bannerFor(
  plan: KeykeeperPlan,
  whose: PlanWhose,
  roles: { isOwner: boolean; isAdmin: boolean },
  planPage: boolean,
  now: Date,
): KeykeeperPlanBanner | null {
  if (!plan.enforced) {
    return null;
  }
  const banner = (kind: KeykeeperPlanBannerKind): KeykeeperPlanBanner => ({
    kind,
    whose,
    plan,
    planPage,
    key: keyOf(kind, whose),
  });
  const ownPool = plan.canManage && plan.coveredBy == null;
  switch (plan.state) {
    case "trial": {
      if (!ownPool || plan.freeUntil == null) {
        return null;
      }
      const left = Date.parse(plan.freeUntil) - now.getTime();
      return left >= 0 && left <= TRIAL_BANNER_DAYS * DAY ? banner("trialEnding") : null;
    }
    case "paymentDue":
      return ownPool && plan.until != null ? banner("paymentDue") : null;
    case "ended":
      return whose.kind !== "person" && (roles.isOwner || roles.isAdmin) ? banner("ended") : null;
    default:
      return null;
  }
}

/**
 * The plan banners for someone in the web vault or the extension: their own
 * plan's, then each organization's, by name.
 */
export function planBanners(
  own: KeykeeperPlan,
  organizations: PlanBannerOrganization[],
  now: Date,
): KeykeeperPlanBanner[] {
  const banners: KeykeeperPlanBanner[] = [];
  const mine = bannerFor(own, { kind: "person" }, { isOwner: true, isAdmin: true }, true, now);
  if (mine != null) {
    banners.push(mine);
  }
  const byName = [...organizations].sort((a, b) => a.name.localeCompare(b.name));
  for (const org of byName) {
    const found = bannerFor(
      org.plan,
      { kind: "organization", id: org.id, name: org.name },
      org,
      organizationPlanPage(org.plan, org.isOwner),
      now,
    );
    if (found != null) {
      banners.push(found);
    }
  }
  return banners;
}

/**
 * The banner for an MSP's pool, for its admins in the MSP console, where its
 * Plan section is. It has no link: the section is on the same page.
 */
export function poolBanner(
  plan: KeykeeperPlan,
  msp: { id: string; name: string },
  now: Date,
): KeykeeperPlanBanner | null {
  return bannerFor(
    plan,
    { kind: "msp", id: msp.id, name: msp.name },
    { isOwner: plan.enforced && plan.canManage, isAdmin: plan.enforced && plan.canManage },
    false,
    now,
  );
}

/** What a banner says. */
export function planBannerWords(
  banner: KeykeeperPlanBanner,
  t: Translate,
  date: DateInWords,
): string {
  const { plan, whose } = banner;
  const name = whose.kind === "person" ? "" : whose.name;
  switch (banner.kind) {
    case "trialEnding": {
      const offer = plan.freeWhy === "offer";
      const when = date(plan.freeUntil!);
      switch (whose.kind) {
        case "person":
          return t(offer ? "keykeeperPlanBannerFreeYou" : "keykeeperPlanBannerTrialYou", when);
        case "organization":
          return t(
            offer ? "keykeeperPlanBannerFreeOrganization" : "keykeeperPlanBannerTrialOrganization",
            name,
            when,
          );
        case "msp":
          return t(
            offer ? "keykeeperPlanBannerFreePool" : "keykeeperPlanBannerTrialPool",
            name,
            when,
          );
      }
      break;
    }
    case "paymentDue": {
      const until = date(plan.until!);
      if (whose.kind === "person") {
        return plan.endsAt == null
          ? t("keykeeperPlanBannerDueYou", until)
          : t("keykeeperPlanBannerDueYouEnds", until, date(plan.endsAt));
      }
      return plan.endsAt == null
        ? t("keykeeperPlanBannerDue", name, until)
        : t("keykeeperPlanBannerDueEnds", name, until, date(plan.endsAt));
    }
    case "ended":
      return t(
        whose.kind === "msp" ? "keykeeperPlanBannerPoolEnded" : "keykeeperPlanBannerEnded",
        name,
      );
  }
  return "";
}

/** The banners someone put away, and the day (in their time zone) they did. */
export const KEYKEEPER_PLAN_BANNERS_PUT_AWAY = new UserKeyDefinition<Record<string, string>>(
  KEYKEEPER_PLAN_DISK,
  "bannersPutAway",
  {
    deserializer: (value) => value ?? {},
    clearOn: ["logout"],
  },
);

/** The day in the person's own time zone, as `YYYY-MM-DD`. */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whether a banner was put away today. */
export function putAwayToday(
  putAway: Record<string, string> | null | undefined,
  key: string,
  now: Date,
): boolean {
  return putAway?.[key] === localDay(now);
}

/** The banners put away, with this one put away today, forgetting other days'. */
export function withPutAway(
  putAway: Record<string, string> | null | undefined,
  key: string,
  now: Date,
): Record<string, string> {
  const today = localDay(now);
  const kept = Object.entries(putAway ?? {}).filter(([, day]) => day === today);
  return { ...Object.fromEntries(kept), [key]: today };
}
