import { KeykeeperPlanEnforced } from "./keykeeper-plan";
import {
  invoiceRows,
  KeykeeperPlanInvoice,
  listsInvoices,
  planInvoicesFrom,
} from "./plan-invoices";
import { translate } from "./plan-messages.spec-util";
import { PlanWhose } from "./plan-words";

const november: KeykeeperPlanInvoice = {
  month: "2026-11",
  seatDays: 311,
  freeDays: 0,
  daysInMonth: 30,
  prorated: 10.37,
  priceCents: 150,
  amountCents: 1556,
  currency: "usd",
  state: "invoiced",
};

function plan(fields: Partial<KeykeeperPlanEnforced>): KeykeeperPlanEnforced {
  return {
    enforced: true,
    plan: "msp",
    state: "active",
    freeUntil: null,
    freeWhy: null,
    until: null,
    renews: true,
    endsAt: null,
    storageGb: null,
    people: null,
    coveredBy: null,
    canManage: true,
    canPay: true,
    ...fields,
  };
}

const pool: PlanWhose = { kind: "msp", id: "msp-1", name: "Contoso IT" };
const acme: PlanWhose = { kind: "organization", id: "org-1", name: "Acme Dental" };

describe("a plan's invoices", () => {
  it("are read as the server sent them, and one that doesn't read is left out", () => {
    expect(
      planInvoicesFrom({ invoices: [november, { ...november, state: "pending", sentAt: null }] }),
    ).toEqual([november, { ...november, state: "pending" }]);
    for (const bad of [
      { month: "2026-13" },
      { month: "November" },
      { seatDays: -1 },
      { seatDays: 1.5 },
      { prorated: "10.37" },
      { prorated: Number.NaN },
      { priceCents: null },
      { amountCents: -5 },
      { currency: "USD" },
      { currency: "dollars" },
      { state: "paid" },
    ] as Record<string, unknown>[]) {
      expect(planInvoicesFrom({ invoices: [{ ...november, ...bad }] })).toEqual([]);
    }
    for (const answer of [null, undefined, {}, { invoices: null }, { invoices: {} }, []]) {
      expect(planInvoicesFrom(answer)).toEqual([]);
    }
  });

  it("are listed in words: the month, its seat-days and free days, prorated seats, the price a seat, the amount, and the state", () => {
    expect(
      invoiceRows(
        [
          november,
          {
            ...november,
            month: "2026-10",
            seatDays: 120,
            freeDays: 9,
            daysInMonth: 31,
            prorated: 3.87,
            amountCents: 581,
            state: "pending",
          },
        ],
        translate,
        "en-US",
      ),
    ).toEqual([
      {
        month: "November 2026",
        seatDays: "311",
        freeDays: null,
        prorated: "10.37",
        price: "$1.50",
        amount: "$15.56",
        state: "Invoiced",
      },
      {
        month: "October 2026",
        seatDays: "120",
        freeDays: "9 of 31 days free",
        prorated: "3.87",
        price: "$1.50",
        amount: "$5.81",
        state: "Being invoiced",
      },
    ]);
    // Two decimals always, as the seat report shows them.
    expect(invoiceRows([{ ...november, prorated: 2 }], translate, "en-US")[0].prorated).toBe(
      "2.00",
    );
    // An unknown locale falls back to US English.
    expect(invoiceRows([november], translate, "not a locale")[0]).toMatchObject({
      month: "November 2026",
      amount: "$15.56",
    });
  });

  it("are listed for whoever may pay for a plan billed by the day", () => {
    expect(listsInvoices(plan({}), pool)).toBe(true);
    expect(listsInvoices(plan({ plan: "business" }), acme)).toBe(true);
    expect(listsInvoices(plan({ canPay: false }), pool)).toBe(false);
    expect(listsInvoices(plan({ canManage: false }), pool)).toBe(false);
    expect(listsInvoices(plan({ plan: "families" }), acme)).toBe(false);
    expect(
      listsInvoices(
        plan({ plan: "business", coveredBy: { id: "msp-1", name: "Contoso IT" } }),
        acme,
      ),
    ).toBe(false);
  });
});
