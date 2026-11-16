/**
 * Keykeeper: a plan in words, for the Plan page (DESIGN.md, "Plans and
 * billing", "Upstream's billing pages go"): its name, its state and dates,
 * what it gives, and which button it has. Everything here is read from
 * `keykeeperPlan` as the server sent it. Nothing works out a state, a date, or
 * what a plan gives: where the server doesn't say, the words leave it out.
 * The values are message keys in brand/messages.en.json.
 */
import { KeykeeperPlanEnforced, KeykeeperPlanName } from "./keykeeper-plan";

/** Whose plan a page or a banner is about. */
export type PlanWhose =
  | { kind: "person" }
  | { kind: "organization"; id: string; name: string }
  | { kind: "msp"; id: string; name: string };

/** A message key and its values in words, as I18nService.t takes them. */
export type Translate = (key: string, ...values: string[]) => string;

/** Translate with an I18nService, which takes up to three values. */
export function translateWith(i18n: {
  t(id: string, p1?: string | number, p2?: string | number, p3?: string | number): string;
}): Translate {
  return (key, ...values) => i18n.t(key, values[0], values[1], values[2]);
}

/** A date the server sent, in words: "December 15, 2026". */
export type DateInWords = (date: string) => string;

/**
 * Dates in words in a locale, in the time zone of the person reading them
 * unless another is given. An unknown locale falls back to US English.
 */
export function dateInWords(locale?: string, timeZone?: string): DateInWords {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone });
  } catch {
    format = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone });
  }
  return (date) => format.format(new Date(date));
}

const NAME_KEYS: Record<KeykeeperPlanName, string> = {
  free: "keykeeperPlanNameFree",
  premium: "keykeeperPlanNamePremium",
  families: "keykeeperPlanNameFamilies",
  business: "keykeeperPlanNameBusiness",
  msp: "keykeeperPlanNameMsp",
};

/** The plan's name: "Premium", "Business", or "No plan". */
export function planNameKey(plan: KeykeeperPlanEnforced): string {
  return plan.plan == null ? "keykeeperPlanNameNone" : NAME_KEYS[plan.plan];
}

/** Whether the plan gives what it gives right now, as the server said. */
export function planInEffect(plan: KeykeeperPlanEnforced): boolean {
  return plan.state === "trial" || plan.state === "active" || plan.state === "paymentDue";
}

/** The plan's state and dates, a line each. */
function statusLines(plan: KeykeeperPlanEnforced, t: Translate, date: DateInWords): string[] {
  switch (plan.state) {
    case "trial":
      if (plan.freeUntil == null) {
        return [t("keykeeperPlanTrial")];
      }
      return [
        t(
          plan.freeWhy === "offer" ? "keykeeperPlanFreeUntil" : "keykeeperPlanTrialUntil",
          date(plan.freeUntil),
        ),
      ];
    case "active": {
      if (plan.until == null) {
        return [t("keykeeperPlanActive")];
      }
      const until = date(plan.until);
      const lines = [t("keykeeperPlanPaidThrough", until)];
      if (plan.renews === true) {
        lines.push(t("keykeeperPlanRenewsOn", until));
      } else if (plan.renews === false) {
        lines.push(t("keykeeperPlanEndsOn", until));
      }
      return lines;
    }
    case "paymentDue":
      if (plan.until == null) {
        return [t("keykeeperPlanPaymentDue")];
      }
      return plan.endsAt == null
        ? [t("keykeeperPlanPaymentDueSince", date(plan.until))]
        : [t("keykeeperPlanPaymentDueEnds", date(plan.until), date(plan.endsAt))];
    case "ended":
      return [
        plan.endsAt == null
          ? t("keykeeperPlanEnded")
          : t("keykeeperPlanEndedOn", date(plan.endsAt)),
      ];
    default:
      return [];
  }
}

/** What the plan gives while it's in effect. */
function givesLines(plan: KeykeeperPlanEnforced, whose: PlanWhose, t: Translate): string[] {
  const lines: string[] = [];
  const storage = plan.storageGb ?? 0;
  switch (whose.kind) {
    case "person":
      if (storage > 0) {
        lines.push(t("keykeeperPlanGivesStorage", String(storage)));
      }
      lines.push(t("keykeeperPlanGivesPremiumYou"));
      break;
    case "organization":
      if (storage > 0) {
        lines.push(t("keykeeperPlanGivesStorageShared", String(storage)));
      }
      lines.push(
        plan.people == null
          ? t("keykeeperPlanGivesAnyNumber")
          : t("keykeeperPlanGivesPeople", String(plan.people)),
      );
      lines.push(t("keykeeperPlanGivesPremiumMembers"));
      break;
    case "msp":
      lines.push(t("keykeeperPlanGivesPool"));
      lines.push(t("keykeeperPlanGivesPremiumPool"));
      break;
  }
  return lines;
}

/** Which of the provider's pages the button opens: to pay or put a card on file, or to manage. */
export type PlanAction = "pay" | "manage";

/**
 * The one button, or none. It's there only when the server says the person
 * can pay (a provider is set and they may manage the plan), never for a
 * client of an MSP, whose pool is the MSP's to pay for, and never for an
 * organization with no plan, since it's unknown which plan it would pay for.
 */
export function planAction(plan: KeykeeperPlanEnforced): PlanAction | null {
  if (!plan.canPay || !plan.canManage || plan.coveredBy != null) {
    return null;
  }
  if (plan.state === "active" || plan.state === "paymentDue") {
    return "manage";
  }
  return plan.plan == null ? null : "pay";
}

/** The plan a "pay" button pays for: a person on Free pays for Premium. */
export function planToPayFor(plan: KeykeeperPlanEnforced): KeykeeperPlanName | null {
  return plan.plan === "free" ? "premium" : plan.plan;
}

export type PlanPageWords = {
  /** "Premium", "Business", "No plan". */
  name: string;
  /** Its state and dates, a line each: "Paid through December 15, 2026". */
  status: string[];
  /** "Covered by Contoso IT", for a client of an MSP. */
  coveredBy: string | null;
  /** What it gives, while it's in effect. */
  gives: string[];
  /** A sentence about what it doesn't give: Free's, or once a plan has ended. */
  note: string | null;
  /** Whether the note is about what Premium has, so the page links to the Pricing page. */
  noteIsPremium: boolean;
  /** The button's label, or null for no button. */
  action: { action: PlanAction; label: string } | null;
};

/**
 * The Plan page in words.
 *
 * @param premiumThroughOrganization a person only: whether the profile says
 * they get Premium's features through an organization or an MSP
 */
export function planPageWords(
  plan: KeykeeperPlanEnforced,
  whose: PlanWhose,
  t: Translate,
  date: DateInWords,
  premiumThroughOrganization = false,
): PlanPageWords {
  const inEffect = planInEffect(plan);
  let gives = inEffect ? givesLines(plan, whose, t) : [];
  let note: string | null = null;
  let noteIsPremium = false;

  if (whose.kind === "person" && !inEffect) {
    if (premiumThroughOrganization) {
      const storage = plan.storageGb ?? 0;
      gives = [
        ...(storage > 0 ? [t("keykeeperPlanGivesStorage", String(storage))] : []),
        t("keykeeperPlanPremiumThroughOrganization"),
      ];
    }
    if (plan.state === "ended") {
      note = t("keykeeperPlanPremiumEnded");
    } else if (!premiumThroughOrganization) {
      note = t("keykeeperPlanFreeNote");
      noteIsPremium = true;
    }
  } else if (plan.state === "ended") {
    note = whose.kind === "msp" ? t("keykeeperPlanPoolEnded") : t("keykeeperPlanOrganizationEnded");
  }

  const action = planAction(plan);
  return {
    name: t(planNameKey(plan)),
    status: statusLines(plan, t, date),
    coveredBy: plan.coveredBy == null ? null : t("keykeeperPlanCoveredBy", plan.coveredBy.name),
    gives,
    note,
    noteIsPremium,
    action:
      action == null
        ? null
        : {
            action,
            label: t(action === "manage" ? "keykeeperPlanManage" : "keykeeperPlanPay"),
          },
  };
}
