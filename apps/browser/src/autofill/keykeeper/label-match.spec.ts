import {
  confidentLabelMatch,
  hasTellingWord,
  labelText,
  labelWords,
  shownLabel,
} from "./label-match";

describe("Keykeeper label matches", () => {
  it("reads words without case, accents, or punctuation, and with run-together names apart", () => {
    expect(labelWords("Customer number")).toEqual(["customer", "number"]);
    expect(labelWords("customerId")).toEqual(["customer", "number"]);
    expect(labelWords("Numéro d'adhérent")).toEqual(["numero", "d", "adherent"]);
    expect(labelWords("Member #")).toEqual(["member", "number"]);
    expect(labelWords("Enter your account no.")).toEqual(["account", "number"]);
  });

  it.each([
    ["Customer number", "Customer ID"],
    ["Customer No.", "customer id"],
    ["Enter your member number", "Member ID"],
    ["Policy #", "Policy number"],
    ["ID, customer", "Customer ID"],
  ])("matches %s with %s", (label, name) => {
    expect(confidentLabelMatch(label, name)).toBe(true);
  });

  it.each([
    // Generic words only.
    ["Name", "Name"],
    ["Code", "Code"],
    ["ID", "Number"],
    ["Your name", "Name"],
    // Different words, even close ones.
    ["Customer number", "Customer"],
    ["Customer number (8 digits)", "Customer ID"],
    ["Address line 1", "Address line 2"],
    ["Member PIN", "Member ID"],
    ["", ""],
  ])("never matches %s with %s", (label, name) => {
    expect(confidentLabelMatch(label, name)).toBe(false);
  });

  it("tells a label that says what it is from one of generic words only", () => {
    expect(hasTellingWord("Customer number")).toBe(true);
    expect(hasTellingWord("Name")).toBe(false);
    expect(hasTellingWord("Enter your code")).toBe(false);
    expect(hasTellingWord("")).toBe(false);
  });

  it("reads the label people see: the label, then the aria label, then the placeholder", () => {
    expect(labelText({ "label-tag": "Customer number", placeholder: "12345" })).toBe(
      "Customer number",
    );
    expect(labelText({ "label-aria": "Member ID", placeholder: "12345" })).toBe("Member ID");
    expect(labelText({ placeholder: "Policy #" })).toBe("Policy #");
    expect(shownLabel({ "label-tag": "  Customer\n number " })).toBe("customer number");
  });
});
