import { KEYKEEPER_PLAN_NOT_ENFORCED, keykeeperPlanFrom } from "./keykeeper-plan";

/** `keykeeperPlan` as the server sends it today, for an owner in grace. */
const fromServer = {
  enforced: true,
  plan: "business",
  state: "paymentDue",
  freeUntil: "2026-10-01T00:00:00.000000Z",
  freeWhy: "trial",
  until: "2026-11-15T12:00:00.000000Z",
  renews: true,
  storageGb: 12,
  people: null,
  coveredBy: null,
  canManage: true,
};

describe("keykeeperPlanFrom", () => {
  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a server that doesn't enforce plans", { enforced: false }],
    ["enforced as a string", { enforced: "true", plan: "premium" }],
    ["a number", 1],
    ["a string", "premium"],
  ])("reads %s as plans not enforced", (_name, value) => {
    expect(keykeeperPlanFrom(value)).toEqual(KEYKEEPER_PLAN_NOT_ENFORCED);
  });

  it("reads what the server sends, with no end date and no button where it doesn't say", () => {
    expect(keykeeperPlanFrom(fromServer)).toEqual({
      ...fromServer,
      endsAt: null,
      canPay: false,
    });
  });

  it("reads the end date and the button where the server says", () => {
    const plan = keykeeperPlanFrom({
      ...fromServer,
      endsAt: "2026-11-29T12:00:00.000000Z",
      canPay: true,
    });
    expect(plan).toMatchObject({ endsAt: "2026-11-29T12:00:00.000000Z", canPay: true });
  });

  it("reads a client of an MSP, whose owners see no dates", () => {
    expect(
      keykeeperPlanFrom({
        ...fromServer,
        plan: "msp",
        state: "active",
        freeUntil: null,
        freeWhy: null,
        until: null,
        renews: null,
        coveredBy: { id: "msp-1", name: "Contoso IT" },
        canManage: false,
      }),
    ).toMatchObject({
      plan: "msp",
      state: "active",
      until: null,
      renews: null,
      coveredBy: { id: "msp-1", name: "Contoso IT" },
      canManage: false,
      canPay: false,
    });
  });

  it("leaves out what it doesn't understand", () => {
    expect(
      keykeeperPlanFrom({
        enforced: true,
        plan: "platinum",
        state: "frozen",
        freeUntil: "soon",
        freeWhy: "because",
        until: 5,
        renews: "yes",
        endsAt: "",
        storageGb: -1,
        people: 2.5,
        coveredBy: { id: 7 },
        canManage: "true",
        canPay: 1,
      }),
    ).toEqual({
      enforced: true,
      plan: null,
      state: null,
      freeUntil: null,
      freeWhy: null,
      until: null,
      renews: null,
      endsAt: null,
      storageGb: null,
      people: null,
      coveredBy: null,
      canManage: false,
      canPay: false,
    });
  });
});
