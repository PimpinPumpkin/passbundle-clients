import {
  describeFillRule,
  describeSource,
  FILL_RULE_FIELD_NAME,
  FillRule,
  fillRuleWords,
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

  it("reads a card's and an identity's values by the names it knows, and skips others", () => {
    const number: FillRule = {
      v: 1,
      host: "shop.example",
      field: { id: "cc" },
      fill: { from: "card", value: "number" },
    };
    const city: FillRule = {
      v: 1,
      host: "shop.example",
      field: { id: "town" },
      fill: { from: "identity", value: "city" },
    };
    const item = {
      fields: [
        stored(number),
        stored({ ...number, fill: { from: "card", value: "pin" } }),
        stored({ ...number, fill: { from: "card" } }),
        stored(city),
        stored({ ...city, fill: { from: "identity", value: "ssn" } }),
      ],
    };

    expect(readFillRules(item)).toEqual([number, city]);
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
      { site: "app.example:8443", text: 'the field labeled "code" gets Verification code' },
    ],
    [
      "a never rule from before rules had a host",
      { v: 1, field: { id: "email" }, fill: { from: "never" } },
      { site: "Every site", text: "the field with id email gets nothing (never fill)" },
    ],
    [
      "the username",
      { v: 1, host: "a.example", field: { id: "u" }, fill: { from: "username" } },
      { site: "a.example", text: "the field with id u gets Username" },
    ],
    [
      "a card's security code",
      { v: 1, host: "js.stripe.com", field: { id: "cvc" }, fill: { from: "card", value: "code" } },
      { site: "js.stripe.com", text: "the field with id cvc gets the card's Security code" },
    ],
    [
      "an identity's city on an http page",
      {
        v: 1,
        host: "shop.example",
        scheme: "http",
        field: { name: "town" },
        fill: { from: "identity", value: "city" },
      },
      { site: "http://shop.example", text: "the field named town gets the identity's City / Town" },
    ],
  ])("says what %s does", (_, rule, expected) => {
    expect(describeFillRule(rule)).toEqual(expected);
  });

  // The words come from the translations: ours for the sentence, and
  // upstream's for the values' names, which come translated; English for
  // anything that isn't.
  it("says it in the person's language", () => {
    const german: Record<string, string> = {
      keykeeperFillRuleFieldWithId: "das Feld mit der ID __$1__",
      keykeeperFillRuleFieldLabeled: 'das Feld "__$1__"',
      keykeeperFillRuleGets: "__$1__ bekommt __$2__",
      keykeeperFillRuleCustomField: "das Feld __$1__",
      keykeeperFillRuleCardValue: "der Karte __$1__",
      keykeeperFillRuleNothing: "nichts (nie füllen)",
      keykeeperFillRuleEverySite: "Jede Website",
      securityCode: "Sicherheitscode",
      username: "Benutzername",
    };
    // As upstream's I18nService fills in placeholders.
    const placeholder = (n: number) => ["__", "$", String(n), "__"].join("");
    const words = fillRuleWords({
      t: (key: string, ...values: string[]) =>
        values.reduce(
          (text, value, i) => text.split(placeholder(i + 1)).join(value),
          german[key] ?? "",
        ),
    });

    expect(describeFillRule(customerId, words)).toEqual({
      site: "bank.example",
      text: "das Feld mit der ID cust bekommt das Feld Customer ID",
    });
    expect(
      describeFillRule({ v: 1, field: { label: "pin" }, fill: { from: "never" } }, words),
    ).toEqual({ site: "Jede Website", text: 'das Feld "pin" bekommt nichts (nie füllen)' });
    expect(describeSource({ from: "card", value: "code" }, words)).toBe(
      "der Karte Sicherheitscode",
    );
    expect(describeSource({ from: "username" }, words)).toBe("Benutzername");
    // Not translated yet: English.
    expect(describeSource({ from: "identity", value: "city" }, words)).toBe(
      "the identity's City / Town",
    );
    expect(
      describeFillRule(
        { v: 1, host: "a.example", field: { name: "n" }, fill: { from: "password" } },
        words,
      ).text,
    ).toBe("the field named n bekommt Password");
  });
});
