import { MspPolicies } from "./msp-api.service";
import {
  allNames,
  clientList,
  clientPolicySummary,
  clientsRequiringChanges,
  defaultPolicyRows,
  describePolicyResult,
  policyEffect,
  rowClientsSummary,
} from "./msp-policies";

const TWO_STEP = 0;
const MASTER_PASSWORD = 1;
const SINGLE_ORG = 3;
const DISABLE_SEND = 6;

const policies: MspPolicies = {
  types: [TWO_STEP, MASTER_PASSWORD, SINGLE_ORG, DISABLE_SEND],
  defaults: [
    { type: TWO_STEP, enabled: false, data: null },
    { type: MASTER_PASSWORD, enabled: true, data: { minLength: 12 } },
    { type: SINGLE_ORG, enabled: true, data: null },
  ],
  clients: [
    { id: "dental", name: "Acme Dental", own: [] },
    {
      id: "law",
      name: "Baker Law",
      own: [
        { type: MASTER_PASSWORD, enabled: true, data: { minLength: 14 } },
        { type: DISABLE_SEND, enabled: true, data: null },
      ],
    },
  ],
};

describe("MSP default policies", () => {
  it("lists the shown policies in order, with clients that have their own setting", () => {
    const rows = defaultPolicyRows(policies, [MASTER_PASSWORD, TWO_STEP, DISABLE_SEND, 99]);
    expect(rows.map((r) => r.type)).toEqual([MASTER_PASSWORD, TWO_STEP, DISABLE_SEND]);
    expect(rows[0].default).toEqual({
      type: MASTER_PASSWORD,
      enabled: true,
      data: { minLength: 12 },
    });
    expect(rows[0].own).toEqual([{ id: "law", name: "Baker Law" }]);
    expect(rows[1].own).toEqual([]);
    // A policy without a stored default is off.
    expect(rows[2].default).toEqual({ type: DISABLE_SEND, enabled: false, data: null });
    // Older servers don't say whether a default is required.
    expect(rows.every((r) => !r.required && r.notInStep.length === 0)).toBe(true);
    expect(rows[0].clients).toBe(2);
  });

  it("says how many clients follow a default or have their own", () => {
    const [master, twoStep] = defaultPolicyRows(policies, [MASTER_PASSWORD, TWO_STEP]);
    expect(rowClientsSummary(master)).toBe("1 follows, 1 has its own");
    expect(rowClientsSummary(twoStep)).toBe("All 2 follow");
    expect(rowClientsSummary({ ...master, own: [], clients: 14 })).toBe("All 14 follow");
    expect(
      rowClientsSummary({
        ...master,
        own: [1, 2].map((n) => ({ id: `${n}`, name: `${n}` })),
        clients: 14,
      }),
    ).toBe("12 follow, 2 have their own");
    expect(rowClientsSummary({ ...master, clients: 1 })).toBe("1 has its own");
    expect(rowClientsSummary({ ...master, own: [], clients: 0 })).toBe("No clients yet");
  });

  it("shows a required default reaching every client, and the clients not in step", () => {
    const required: MspPolicies = {
      ...policies,
      defaults: [
        {
          type: TWO_STEP,
          enabled: true,
          data: null,
          required: true,
          hadOwn: [{ id: "law", name: "Baker Law" }],
        },
        ...policies.defaults.slice(1),
      ],
      clients: [
        { id: "dental", name: "Acme Dental", own: [] },
        {
          id: "law",
          name: "Baker Law",
          own: [{ type: DISABLE_SEND, enabled: true, data: null }],
          notInStep: [{ type: TWO_STEP, enabled: false, data: null }],
        },
      ],
    };
    const [row] = defaultPolicyRows(required, [TWO_STEP]);
    expect(row.required).toBe(true);
    expect(row.own).toEqual([]);
    expect(row.notInStep).toEqual([{ id: "law", name: "Baker Law" }]);
    expect(row.hadOwn).toEqual([{ id: "law", name: "Baker Law" }]);
    expect(rowClientsSummary(row)).toBe("1 of 2 clients");
    expect(rowClientsSummary({ ...row, notInStep: [] })).toBe("all 2 clients");
    expect(rowClientsSummary({ ...row, notInStep: [], clients: 14 })).toBe("all 14 clients");
    expect(rowClientsSummary({ ...row, notInStep: [], clients: 1 })).toBe("1 client");
    expect(clientPolicySummary(required, "law", [TWO_STEP, DISABLE_SEND])).toBe(
      "1 own setting, 1 required not in step",
    );
    expect(clientPolicySummary(required, "law", [TWO_STEP])).toBe("1 required not in step");
  });

  it("compares policies by what they do, as the server does", () => {
    expect(policyEffect({ enabled: false, data: { minLength: 12 } })).toBeNull();
    expect(policyEffect({ enabled: true, data: null })).toBe(
      policyEffect({ enabled: true, data: {} }),
    );
    expect(policyEffect({ enabled: true, data: { a: 1, b: null } })).toBe(
      policyEffect({ enabled: true, data: { a: 1 } }),
    );
    expect(policyEffect({ enabled: true, data: { a: 1, b: 2 } })).toBe(
      policyEffect({ enabled: true, data: { b: 2, a: 1 } }),
    );
    expect(policyEffect({ enabled: true, data: { a: 1 } })).not.toBe(
      policyEffect({ enabled: true, data: { a: 2 } }),
    );
  });

  it("names every client a requirement changes, those with their own setting too", () => {
    // Requiring master passwords of 12: only Baker Law (14, its own) changes.
    expect(
      clientsRequiringChanges(policies, MASTER_PASSWORD, {
        enabled: true,
        data: { minLength: 12 },
      }),
    ).toEqual([{ id: "law", name: "Baker Law", own: true, enabled: true }]);
    // Requiring 16: every client, followers too.
    expect(
      clientsRequiringChanges(policies, MASTER_PASSWORD, {
        enabled: true,
        data: { minLength: 16 },
      }).map((c) => c.name),
    ).toEqual(["Acme Dental", "Baker Law"]);
    // Two-step login is off everywhere: both change, from off.
    expect(clientsRequiringChanges(policies, TWO_STEP, { enabled: true, data: null })).toEqual([
      { id: "dental", name: "Acme Dental", own: false, enabled: false },
      { id: "law", name: "Baker Law", own: false, enabled: false },
    ]);
  });

  it("names every client, however many", () => {
    const c = (name: string) => ({ id: name, name });
    expect(allNames([c("A")])).toBe("A");
    expect(allNames([c("A"), c("B")])).toBe("A and B");
    expect(allNames(["A", "B", "C", "D"].map(c))).toBe("A, B, C, and D");
  });

  it("sums up each client's policies, counting only the policies shown", () => {
    const shown = [TWO_STEP, MASTER_PASSWORD, SINGLE_ORG, DISABLE_SEND];
    expect(clientPolicySummary(policies, "dental", shown)).toBe("Defaults");
    expect(clientPolicySummary(policies, "law", shown)).toBe("2 own settings");
    expect(clientPolicySummary(policies, "law", [MASTER_PASSWORD])).toBe("1 own setting");
    expect(clientPolicySummary(policies, "unknown", shown)).toBe("");
    expect(clientPolicySummary(null, "law", shown)).toBe("");
  });

  it("names clients in a sentence", () => {
    const c = (name: string) => ({ id: name, name });
    expect(clientList([c("A")])).toBe("A");
    expect(clientList([c("A"), c("B")])).toBe("A and B");
    expect(clientList([c("A"), c("B"), c("C")])).toBe("A, B, and C");
    expect(clientList([c("A"), c("B"), c("C"), c("D")])).toBe("4 clients");
  });

  it("says what a change did", () => {
    const c = (name: string) => ({ id: name, name });
    expect(
      describePolicyResult({
        changed: [c("Acme Dental"), c("Corner Bakery")],
        kept: [c("Baker Law")],
        refused: [],
      }),
    ).toBe("Changed in Acme Dental and Corner Bakery. Baker Law kept its own setting.");
    expect(describePolicyResult({ changed: [], kept: [c("A"), c("B")], refused: [] })).toBe(
      "No client needed a change. A and B kept their own setting.",
    );
    expect(
      describePolicyResult({
        changed: [c("A")],
        refused: [{ ...c("B"), error: "Single organization is off" }],
      }),
    ).toBe("Changed in A. B refused it: Single organization is off");
  });
});
