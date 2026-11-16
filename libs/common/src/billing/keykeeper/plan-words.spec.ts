import { KeykeeperPlanEnforced, keykeeperPlanFrom } from "./keykeeper-plan";
import { date, translate } from "./plan-messages.spec-util";
import { dateInWords, planAction, planPageWords, planToPayFor, PlanWhose } from "./plan-words";

const NOV_15 = "2026-11-15T12:00:00.000000Z";
const NOV_29 = "2026-11-29T12:00:00.000000Z";
const DEC_15 = "2026-12-15T12:00:00.000000Z";
const JUN_1 = "2027-06-01T12:00:00.000000Z";

const PREMIUM_FEATURES =
  "Premium's features: attaching files, sending files, the data breach report, and two-step login codes for your other accounts";
const MEMBERS_FEATURES =
  "Premium's features for every member: attaching files, sending files, the data breach report, and two-step login codes for their other accounts";
const FREE_NOTE =
  "Attaching files, sending files, the data breach report, and two-step login codes for your other accounts are part of Premium.";
const ORGANIZATION_ENDED =
  "This organization's plan has ended, so nothing new can be added. Everything in it can still be opened, changed, exported, and deleted.";

/** A plan as an owner sees it, with what each test changes. */
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

const person: PlanWhose = { kind: "person" };
const acme: PlanWhose = { kind: "organization", id: "org-1", name: "Acme Dental" };
const contoso: PlanWhose = { kind: "msp", id: "msp-1", name: "Contoso IT" };

const words = (p: KeykeeperPlanEnforced, whose: PlanWhose, throughOrganization = false) =>
  planPageWords(p, whose, translate, date, throughOrganization);

describe("the Plan page in words", () => {
  describe("a person", () => {
    const premium = (fields: Partial<KeykeeperPlanEnforced>) =>
      plan({ plan: "premium", storageGb: 5, ...fields });

    it("on Free, says what Premium has and links to the Pricing page", () => {
      expect(words(plan({ plan: "free", state: null, storageGb: 0 }), person)).toEqual({
        name: "Free",
        status: [],
        coveredBy: null,
        gives: [],
        note: FREE_NOTE,
        noteIsPremium: true,
        action: null,
      });
    });

    it("on Free with Premium's features through an organization, says so", () => {
      const w = words(plan({ plan: "free", state: null, storageGb: 5 }), person, true);
      expect(w.gives).toEqual([
        "5 GB for attachments",
        "You get Premium's features through an organization or an MSP you belong to.",
      ]);
      expect(w.note).toBeNull();
    });

    it("on Premium that renews: when it renews, once", () => {
      const w = words(premium({ until: DEC_15, renews: true }), person);
      expect(w.name).toBe("Premium");
      expect(w.status).toEqual(["Renews on December 15, 2026"]);
      expect(w.gives).toEqual(["5 GB for attachments", PREMIUM_FEATURES]);
      expect(w.note).toBeNull();
    });

    it("on Premium that was canceled: when it ends, once", () => {
      expect(words(premium({ until: DEC_15, renews: false }), person).status).toEqual([
        "Ends on December 15, 2026",
      ]);
    });

    it("on Premium where the server doesn't say whether it renews: paid through", () => {
      expect(words(premium({ until: DEC_15, renews: null }), person).status).toEqual([
        "Paid through December 15, 2026",
      ]);
    });

    it("with a payment due, says when it was paid through", () => {
      const w = words(premium({ state: "paymentDue", until: NOV_15, renews: true }), person);
      expect(w.status).toEqual(["Payment due. Paid through November 15, 2026."]);
      // Grace changes nothing yet.
      expect(w.gives).toEqual(["5 GB for attachments", PREMIUM_FEATURES]);
    });

    it("with a payment due, says when it ends where the server says", () => {
      const p = premium({ state: "paymentDue", until: NOV_15, renews: true, endsAt: NOV_29 });
      expect(words(p, person).status).toEqual([
        "Payment due. Paid through November 15, 2026; it ends on November 29, 2026.",
      ]);
    });

    it("once Premium has ended, says when and that everything stays", () => {
      const w = words(
        premium({ state: "ended", until: NOV_15, renews: true, endsAt: NOV_29, storageGb: 0 }),
        person,
      );
      expect(w.status).toEqual(["Ended on November 29, 2026"]);
      expect(w.gives).toEqual([]);
      expect(w.note).toBe(
        "You're on Free now. Everything you saved stays, and files you attached can still be downloaded and removed.",
      );
      expect(w.noteIsPremium).toBe(false);
    });

    it("once Premium has ended, leaves the date out where the server doesn't say it", () => {
      expect(
        words(premium({ state: "ended", until: NOV_15, storageGb: 0 }), person).status,
      ).toEqual(["Ended"]);
    });
  });

  describe("an organization", () => {
    it("in its trial: trial until, and what it gives", () => {
      const w = words(
        plan({ state: "trial", freeUntil: DEC_15, freeWhy: "trial", renews: false }),
        acme,
      );
      expect(w).toEqual({
        name: "Business",
        status: ["Trial until December 15, 2026"],
        coveredBy: null,
        gives: [
          "12 GB for attachments in shared folders",
          "Any number of people",
          MEMBERS_FEATURES,
        ],
        note: null,
        noteIsPremium: false,
        action: null,
      });
    });

    it("free under an offer: free until", () => {
      expect(
        words(plan({ state: "trial", freeUntil: JUN_1, freeWhy: "offer" }), acme).status,
      ).toEqual(["Free until June 1, 2027"]);
    });

    it("on Families: up to its six people", () => {
      const w = words(
        plan({ plan: "families", until: DEC_15, renews: true, people: 6, storageGb: 6 }),
        acme,
      );
      expect(w.name).toBe("Families");
      expect(w.gives).toEqual([
        "6 GB for attachments in shared folders",
        "Up to 6 people",
        MEMBERS_FEATURES,
      ]);
    });

    it("covered by an MSP, for its owners who see no dates: covered by the MSP", () => {
      const w = words(
        plan({
          plan: "msp",
          state: "trial",
          coveredBy: { id: "msp-1", name: "Contoso IT" },
          canManage: false,
        }),
        acme,
      );
      expect(w.name).toBe("MSP seat pool");
      expect(w.status).toEqual(["Trial"]);
      expect(w.coveredBy).toBe("Covered by Contoso IT");
    });

    it("active, for someone who sees no dates: active", () => {
      expect(words(plan({ canManage: false }), acme).status).toEqual(["Active"]);
    });

    it("once its plan has ended: the server's sentence, and nothing it gives", () => {
      const w = words(
        plan({ state: "ended", freeUntil: NOV_15, freeWhy: "trial", endsAt: NOV_15, storageGb: 0 }),
        acme,
      );
      expect(w.status).toEqual(["Ended on November 15, 2026"]);
      expect(w.gives).toEqual([]);
      expect(w.note).toBe(ORGANIZATION_ENDED);
    });

    it("with no plan: no plan", () => {
      const w = words(plan({ plan: null, state: null, storageGb: 0 }), acme);
      expect(w.name).toBe("No plan");
      expect(w.status).toEqual([]);
      expect(w.gives).toEqual([]);
      expect(w.note).toBeNull();
    });
  });

  describe("an MSP's pool", () => {
    it("with a card on file and no end date: active, and what it covers", () => {
      const w = words(plan({ plan: "msp", renews: true, storageGb: null }), contoso);
      expect(w.status).toEqual(["Active"]);
      expect(w.gives).toEqual([
        "Every client covered as Business, with any number of people",
        "Premium's features for your staff and for every member of each client",
      ]);
    });

    it("once it has ended: its clients keep everything and take nothing new", () => {
      const w = words(plan({ plan: "msp", state: "ended", storageGb: null }), contoso);
      expect(w.status).toEqual(["Ended"]);
      expect(w.note).toBe(
        "Your clients' plan has ended, so nothing new can be added to them. Everything in them can still be opened, changed, exported, and deleted.",
      );
    });
  });
});

describe("the Plan page's button", () => {
  it("isn't there while the server doesn't say a provider is set", () => {
    // As the server sends `keykeeperPlan` before piece 8: no `canPay`.
    const fromServer = keykeeperPlanFrom({
      enforced: true,
      plan: "business",
      state: "trial",
      freeUntil: DEC_15,
      freeWhy: "trial",
      until: null,
      renews: false,
      storageGb: 12,
      people: null,
      coveredBy: null,
      canManage: true,
    }) as KeykeeperPlanEnforced;
    expect(planAction(fromServer)).toBeNull();
    expect(words(fromServer, acme).action).toBeNull();
  });

  it.each([
    ["a trial", { state: "trial" }, "pay", "Set up payment"],
    ["a plan that has ended", { state: "ended" }, "pay", "Set up payment"],
    ["Free", { plan: "free", state: null }, "pay", "Set up payment"],
    ["a plan in good standing", { state: "active" }, "manage", "Manage payment"],
    ["a payment due", { state: "paymentDue", until: NOV_15 }, "manage", "Manage payment"],
  ] as const)("opens the provider's page for %s", (_name, fields, action, label) => {
    const p = plan({ ...fields, canPay: true });
    expect(planAction(p)).toBe(action);
    expect(words(p, person).action).toEqual({ action, label });
  });

  it("isn't there for someone who doesn't manage the plan", () => {
    expect(planAction(plan({ canPay: true, canManage: false }))).toBeNull();
  });

  it("isn't there for a client of an MSP, whose pool the MSP pays for", () => {
    const client = plan({ canPay: true, coveredBy: { id: "msp-1", name: "Contoso IT" } });
    expect(planAction(client)).toBeNull();
  });

  it("isn't there for an organization with no plan, since which plan to pay for isn't known", () => {
    expect(planAction(plan({ plan: null, state: null, canPay: true }))).toBeNull();
  });

  it("pays for Premium for a person on Free, and for the plan itself otherwise", () => {
    expect(planToPayFor(plan({ plan: "free" }))).toBe("premium");
    expect(planToPayFor(plan({ plan: "families" }))).toBe("families");
  });
});

describe("dateInWords", () => {
  it("says a date in words in the locale and time zone given", () => {
    expect(dateInWords("en-US", "UTC")(DEC_15)).toBe("December 15, 2026");
    // Late in the day in UTC is the next day further east.
    expect(dateInWords("en-US", "Asia/Tokyo")("2026-12-15T20:00:00Z")).toBe("December 16, 2026");
  });

  it("falls back to US English for a locale it doesn't know", () => {
    expect(dateInWords("not a locale", "UTC")(DEC_15)).toBe("December 15, 2026");
  });
});
