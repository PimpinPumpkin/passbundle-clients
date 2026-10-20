import {
  describeFillRule,
  FILL_RULE_FIELD_NAME,
  FillRule,
  readFillRules,
  removeFillRule,
} from "./fill-rules";

const field = (name: string, value: string) => ({ name, value });
const stored = (rule: unknown) => field(FILL_RULE_FIELD_NAME, JSON.stringify(rule));

const customerId: FillRule = {
  v: 1,
  host: "bank.example",
  field: { id: "cust", name: "customer", label: "customer number" },
  fill: { from: "field", name: "Customer ID" },
};
const neverPin: FillRule = {
  v: 1,
  host: "bank.example",
  field: { name: "pin" },
  fill: { from: "never" },
};

describe("fill rules on an item", () => {
  it("reads the rules it understands and skips anything else", () => {
    const item = {
      fields: [
        field("Customer ID", "12345"),
        stored(customerId),
        field(FILL_RULE_FIELD_NAME, "not json"),
        stored({ v: 2, field: {}, fill: { from: "username" } }),
        stored({ v: 1, field: null, fill: { from: "username" } }),
        stored({ v: 1, field: {}, fill: { from: "field" } }),
        stored(neverPin),
      ],
    };

    expect(readFillRules(item)).toEqual([customerId, neverPin]);
    expect(readFillRules(null)).toEqual([]);
  });

  it("removes one rule and keeps every other field, unreadable rules included", () => {
    const item = {
      fields: [
        field("Customer ID", "12345"),
        stored(customerId),
        field(FILL_RULE_FIELD_NAME, "not json"),
        stored(neverPin),
        field("keykeeper.expires", "2027-01-01"),
      ],
    };

    removeFillRule(item, customerId);

    expect(item.fields.map((f) => f.value)).toEqual([
      "12345",
      "not json",
      JSON.stringify(neverPin),
      "2027-01-01",
    ]);
  });

  it("removes a rule by its field and host, not by what it fills", () => {
    const item = { fields: [stored(customerId)] };

    removeFillRule(item, { ...customerId, fill: { from: "never" } });
    expect(item.fields).toEqual([]);
  });

  it("keeps the same field's rule for another host", () => {
    const elsewhere = { ...customerId, host: "other.example" };
    const item = { fields: [stored(customerId), stored(elsewhere)] };

    removeFillRule(item, customerId);
    expect(readFillRules(item)).toEqual([elsewhere]);
  });
});

describe("describeFillRule", () => {
  it.each<[string, FillRule, { site: string; text: string }]>([
    [
      "a custom field into a field found by id",
      customerId,
      { site: "bank.example", text: "the field with id cust gets the Customer ID field" },
    ],
    [
      "never into a field found by name",
      neverPin,
      { site: "bank.example", text: "the field named pin gets nothing (never fill)" },
    ],
    [
      "the one-time code into a field found by label",
      { v: 1, host: "app.example:8443", field: { label: "code" }, fill: { from: "totp" } },
      { site: "app.example:8443", text: 'the field labeled "code" gets the one-time code' },
    ],
    [
      "a never rule from before rules had a host",
      { v: 1, field: { id: "email" }, fill: { from: "never" } },
      { site: "Every site", text: "the field with id email gets nothing (never fill)" },
    ],
    [
      "the username and password",
      { v: 1, host: "a.example", field: { id: "u" }, fill: { from: "username" } },
      { site: "a.example", text: "the field with id u gets the username" },
    ],
  ])("says what %s does", (_, rule, expected) => {
    expect(describeFillRule(rule)).toEqual(expected);
  });
});
