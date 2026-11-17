import {
  KEYKEEPER_PLAN_NOT_ENFORCED,
  KeykeeperPlan,
  KeykeeperPlanEnforced,
} from "./keykeeper-plan";
import {
  localDay,
  organizationPlanPage,
  PlanBannerOrganization,
  planBanners,
  planBannerWords,
  poolBanner,
  putAwayToday,
  TRIAL_BANNER_DAYS,
  withPutAway,
} from "./plan-banners";
import { date, translate } from "./plan-messages.spec-util";

const DAY = 86_400_000;
const NOW = new Date("2026-12-08T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const STAYS =
  "If it isn't paid for by then, nothing new can be added to it. Everything in it can still be opened, changed, exported, and deleted.";

/** Two-step codes, for Premium and Families: they need Premium, and the keys stay. */
const CODES_YOURS =
  "Without Premium, two-step login codes don't show on your items; their keys stay, and the codes come back with Premium.";
const CODES_MEMBERS =
  "Without Premium, members' two-step login codes don't show on their own items; the keys stay, and the codes come back with Premium.";

function plan(fields: Partial<KeykeeperPlanEnforced>): KeykeeperPlanEnforced {
  return {
    enforced: true,
    plan: "business",
    state: "active",
    freeUntil: null,
    freeWhy: null,
    until: null,
    renews: null,
    endsAt: null,
    storageGb: 12,
    people: null,
    coveredBy: null,
    canManage: true,
    canPay: false,
    ...fields,
  };
}

const free = plan({ plan: "free", state: null, storageGb: 0 });

function org(
  name: string,
  p: KeykeeperPlan,
  role: "owner" | "admin" | "user" = "owner",
): PlanBannerOrganization {
  return {
    id: `id-${name}`,
    name,
    plan: p,
    isOwner: role === "owner",
    isAdmin: role === "owner" || role === "admin",
  };
}

/** A trial ending this far from now, as its owner sees it. */
const trial = (ms: number, why: "trial" | "offer" = "trial") =>
  plan({ state: "trial", freeUntil: at(ms), freeWhy: why, renews: false });

/** As members see it: no dates, and nothing to manage. */
const asMember = (p: KeykeeperPlanEnforced) =>
  plan({
    ...p,
    freeUntil: null,
    freeWhy: null,
    until: null,
    renews: null,
    endsAt: null,
    canManage: false,
  });

const kinds = (own: KeykeeperPlan, orgs: PlanBannerOrganization[]) =>
  planBanners(own, orgs, NOW).map((b) => `${b.kind} ${b.key}`);

describe("which plan banners someone sees", () => {
  describe("a trial ending", () => {
    it("shows to the owner from 7 days before it ends", () => {
      expect(TRIAL_BANNER_DAYS).toBe(7);
      expect(kinds(free, [org("Acme", trial(7 * DAY))])).toEqual([
        "trialEnding trialEnding:organization:id-Acme",
      ]);
      expect(kinds(free, [org("Acme", trial(DAY))])).toHaveLength(1);
      expect(kinds(free, [org("Acme", trial(0))])).toHaveLength(1);
    });

    it("doesn't show earlier than that", () => {
      expect(kinds(free, [org("Acme", trial(7 * DAY + 1000))])).toEqual([]);
      expect(kinds(free, [org("Acme", trial(20 * DAY))])).toEqual([]);
    });

    it("shows for a free offer ending, too", () => {
      expect(kinds(free, [org("Acme", trial(3 * DAY, "offer"))])).toHaveLength(1);
    });

    it("doesn't show to admins or members, who don't manage the plan", () => {
      const ending = asMember(trial(DAY));
      expect(kinds(free, [org("Acme", ending, "admin"), org("Baker", ending, "user")])).toEqual([]);
    });

    it("doesn't show for a client of an MSP: the pool's trial is the MSP's admins', in the console", () => {
      const client = plan({ ...trial(DAY), coveredBy: { id: "msp-1", name: "Contoso IT" } });
      expect(kinds(free, [org("Acme", client)])).toEqual([]);
    });

    it("shows for a person's own trial", () => {
      const own = plan({ ...trial(2 * DAY), plan: "premium" });
      expect(kinds(own, [])).toEqual(["trialEnding trialEnding:person"]);
    });
  });

  describe("a payment due", () => {
    const due = plan({ state: "paymentDue", until: at(-2 * DAY), renews: true });

    it("shows to whoever pays", () => {
      expect(kinds(plan({ ...due, plan: "premium" }), [org("Acme", due)])).toEqual([
        "paymentDue paymentDue:person",
        "paymentDue paymentDue:organization:id-Acme",
      ]);
    });

    it("doesn't show to anyone else, who is told the plan is active", () => {
      // The server tells a member a plan in grace is active, since grace changes nothing for them.
      expect(kinds(free, [org("Acme", asMember(plan({})), "admin")])).toEqual([]);
    });

    it("doesn't show for a client of an MSP", () => {
      const client = plan({ ...due, coveredBy: { id: "msp-1", name: "Contoso IT" } });
      expect(kinds(free, [org("Acme", client)])).toEqual([]);
    });
  });

  describe("an organization's plan having ended", () => {
    const ended = plan({ state: "ended", storageGb: 0 });

    it("shows to its owners and admins, and links only owners to the Plan page", () => {
      const banners = planBanners(
        free,
        [org("Acme", ended, "owner"), org("Baker", asMember(ended), "admin")],
        NOW,
      );
      expect(banners.map((b) => [b.kind, b.whose, b.planPage])).toEqual([
        ["ended", { kind: "organization", id: "id-Acme", name: "Acme" }, true],
        ["ended", { kind: "organization", id: "id-Baker", name: "Baker" }, false],
      ]);
    });

    it("doesn't show to members", () => {
      expect(kinds(free, [org("Acme", asMember(ended), "user")])).toEqual([]);
    });

    it("shows for a client whose MSP's pool has ended, to the client's owners and admins", () => {
      const client = asMember(
        plan({ ...ended, plan: "msp", coveredBy: { id: "msp-1", name: "Contoso IT" } }),
      );
      expect(kinds(free, [org("Acme", client, "owner"), org("Baker", client, "admin")])).toEqual([
        "ended ended:organization:id-Acme",
        "ended ended:organization:id-Baker",
      ]);
    });

    it("doesn't show for a person whose Premium has ended", () => {
      expect(kinds(plan({ plan: "premium", state: "ended" }), [])).toEqual([]);
    });
  });

  it("shows nothing for a plan in good standing, Free, or an organization with no plan", () => {
    expect(
      kinds(free, [
        org("Acme", plan({ until: at(30 * DAY), renews: true })),
        org("Baker", plan({ plan: null, state: null })),
      ]),
    ).toEqual([]);
  });

  it("shows nothing at all where plans aren't enforced", () => {
    expect(
      kinds(KEYKEEPER_PLAN_NOT_ENFORCED, [
        org("Acme", KEYKEEPER_PLAN_NOT_ENFORCED, "owner"),
        org("Baker", KEYKEEPER_PLAN_NOT_ENFORCED, "admin"),
      ]),
    ).toEqual([]);
  });

  it("puts the person's own first, then organizations by name", () => {
    const own = plan({ plan: "premium", state: "paymentDue", until: at(-DAY), renews: true });
    const ended = plan({ state: "ended" });
    expect(kinds(own, [org("Zephyr", ended), org("Acme", ended)])).toEqual([
      "paymentDue paymentDue:person",
      "ended ended:organization:id-Acme",
      "ended ended:organization:id-Zephyr",
    ]);
  });
});

describe("who has an organization's Plan page", () => {
  it("is its owners, and whoever manages its plan, where plans are enforced", () => {
    expect(organizationPlanPage(plan({ canManage: false }), true)).toBe(true);
    expect(organizationPlanPage(plan({ canManage: true }), false)).toBe(true);
    expect(organizationPlanPage(plan({ canManage: false }), false)).toBe(false);
    expect(organizationPlanPage(KEYKEEPER_PLAN_NOT_ENFORCED, true)).toBe(false);
  });
});

describe("an MSP's pool", () => {
  const contoso = { id: "msp-1", name: "Contoso IT" };

  it("gets the banners for its admins", () => {
    expect(poolBanner(plan({ ...trial(DAY), plan: "msp" }), contoso, NOW)?.kind).toBe(
      "trialEnding",
    );
    expect(
      poolBanner(plan({ plan: "msp", state: "paymentDue", until: at(-DAY) }), contoso, NOW)?.kind,
    ).toBe("paymentDue");
    expect(poolBanner(plan({ plan: "msp", state: "ended" }), contoso, NOW)?.kind).toBe("ended");
    expect(poolBanner(plan({ plan: "msp", renews: true }), contoso, NOW)).toBeNull();
  });

  it("gets none for someone who doesn't manage it, or where plans aren't enforced", () => {
    expect(
      poolBanner(plan({ plan: "msp", state: "ended", canManage: false }), contoso, NOW),
    ).toBeNull();
    expect(poolBanner(KEYKEEPER_PLAN_NOT_ENFORCED, contoso, NOW)).toBeNull();
  });
});

describe("what a plan banner says", () => {
  const say = (own: KeykeeperPlan, orgs: PlanBannerOrganization[]) =>
    planBanners(own, orgs, NOW).map((b) => planBannerWords(b, translate, date));
  const pool = (p: KeykeeperPlanEnforced) =>
    planBannerWords(poolBanner(p, { id: "msp-1", name: "Contoso IT" }, NOW)!, translate, date);

  it("for a trial ending", () => {
    expect(say(free, [org("Acme Dental", trial(7 * DAY))])).toEqual([
      `The trial for Acme Dental ends on December 15, 2026. ${STAYS}`,
    ]);
    expect(say(free, [org("Acme Dental", trial(7 * DAY, "offer"))])).toEqual([
      `Acme Dental is free until December 15, 2026. ${STAYS}`,
    ]);
    expect(say(plan({ ...trial(7 * DAY), plan: "premium" }), [])).toEqual([
      `Your Premium trial ends on December 15, 2026. If it isn't paid for by then, attaching files, sending files, and the data breach report stop. Everything you saved stays. ${CODES_YOURS}`,
    ]);
    expect(say(plan({ ...trial(7 * DAY, "offer"), plan: "premium" }), [])).toEqual([
      `Premium is free for you until December 15, 2026. If it isn't paid for by then, attaching files, sending files, and the data breach report stop. Everything you saved stays. ${CODES_YOURS}`,
    ]);
    expect(pool(plan({ ...trial(7 * DAY), plan: "msp" }))).toBe(
      "The trial for Contoso IT ends on December 15, 2026. If it isn't paid for by then, nothing new can be added to your clients. Everything in them can still be opened, changed, exported, and deleted.",
    );
    expect(pool(plan({ ...trial(7 * DAY, "offer"), plan: "msp" }))).toBe(
      "Contoso IT is free until December 15, 2026. If it isn't paid for by then, nothing new can be added to your clients. Everything in them can still be opened, changed, exported, and deleted.",
    );
  });

  it("for a payment due, with the end date where the server says it", () => {
    const due = plan({ state: "paymentDue", until: at(-7 * DAY), renews: true });
    const dueEnds = plan({ ...due, endsAt: at(7 * DAY) });
    expect(say(plan({ ...due, plan: "premium" }), [org("Acme Dental", due)])).toEqual([
      `A payment for your Premium is due. It was paid through December 1, 2026. ${CODES_YOURS}`,
      "A payment for Acme Dental is due. It was paid through December 1, 2026.",
    ]);
    expect(say(plan({ ...dueEnds, plan: "premium" }), [org("Acme Dental", dueEnds)])).toEqual([
      `A payment for your Premium is due. It was paid through December 1, 2026, and it ends on December 15, 2026 if it isn't paid by then. ${CODES_YOURS}`,
      "A payment for Acme Dental is due. It was paid through December 1, 2026, and it ends on December 15, 2026 if it isn't paid by then.",
    ]);
    expect(pool(plan({ ...dueEnds, plan: "msp" }))).toBe(
      "A payment for Contoso IT is due. It was paid through December 1, 2026, and it ends on December 15, 2026 if it isn't paid by then.",
    );
  });

  it("for Families, what happens to members' two-step codes, and for Business and a pool, nothing about them", () => {
    const family = (p: KeykeeperPlanEnforced) => plan({ ...p, plan: "families" });
    expect(say(free, [org("The Lopez family", family(trial(7 * DAY, "offer")))])).toEqual([
      `The Lopez family is free until December 15, 2026. ${STAYS} ${CODES_MEMBERS}`,
    ]);
    const due = plan({ state: "paymentDue", until: at(-7 * DAY), renews: true });
    expect(say(free, [org("The Lopez family", family(due))])).toEqual([
      `A payment for The Lopez family is due. It was paid through December 1, 2026. ${CODES_MEMBERS}`,
    ]);
    expect(say(free, [org("The Lopez family", family(plan({ state: "ended" })))])).toEqual([
      `The plan for The Lopez family has ended, so nothing new can be added to it. Everything in it can still be opened, changed, exported, and deleted. ${CODES_MEMBERS}`,
    ]);
    const business = [
      org("Acme Dental", trial(7 * DAY)),
      org("Acme Labs", due),
      org("Acme Tools", plan({ state: "ended" })),
    ];
    for (const words of say(free, business)) {
      expect(words).not.toContain("two-step");
    }
    expect(pool(plan({ ...trial(7 * DAY), plan: "msp" }))).not.toContain("two-step");
  });

  it("once an organization's plan has ended", () => {
    expect(say(free, [org("Acme Dental", plan({ state: "ended" }), "admin")])).toEqual([
      "The plan for Acme Dental has ended, so nothing new can be added to it. Everything in it can still be opened, changed, exported, and deleted.",
    ]);
    expect(pool(plan({ plan: "msp", state: "ended" }))).toBe(
      "The plan for Contoso IT has ended, so nothing new can be added to your clients. Everything in them can still be opened, changed, exported, and deleted.",
    );
  });
});

describe("putting a banner away for the day", () => {
  const key = "ended:organization:id-Acme";

  it("keeps it away for the rest of the day, and not the next", () => {
    const putAway = withPutAway({}, key, NOW);
    expect(putAwayToday(putAway, key, NOW)).toBe(true);
    expect(putAwayToday(putAway, key, new Date(NOW.getTime() + DAY))).toBe(false);
    expect(putAwayToday(putAway, "paymentDue:person", NOW)).toBe(false);
    expect(putAwayToday(null, key, NOW)).toBe(false);
  });

  it("forgets the days before", () => {
    const yesterday = new Date(NOW.getTime() - DAY);
    const putAway = withPutAway({ "paymentDue:person": localDay(yesterday) }, key, NOW);
    expect(putAway).toEqual({ [key]: localDay(NOW) });
  });

  it("names the day in the person's own time zone", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
