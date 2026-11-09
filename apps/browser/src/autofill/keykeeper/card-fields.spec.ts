import {
  autofillHint,
  hasOptionValue,
  looksAlike,
  monthOption,
  nameParts,
  yearOption,
} from "./card-fields";
import { phonePartFor, phoneParts } from "./identity-fields";

describe("autofill hints", () => {
  it("is the standard's field name, after a section, shipping or billing, or a kind of contact", () => {
    expect(autofillHint({ autoCompleteType: "cc-number" })).toBe("cc-number");
    expect(autofillHint({ autoCompleteType: "section-pay billing cc-exp" })).toBe("cc-exp");
    expect(autofillHint({ autoCompleteType: "Shipping Name" })).toBe("name");
    expect(autofillHint({ autoCompleteType: "work tel" })).toBe("tel");
  });

  it("is nothing for on, off, missing, or a word the standard doesn't name", () => {
    for (const none of ["on", "off", "", "nope", "new-card", undefined]) {
      expect(autofillHint({ autoCompleteType: none as string })).toBeNull();
    }
  });
});

describe("look-alike words", () => {
  it("never takes cid inside another word for the security code", () => {
    expect(looksAlike("cidade", "code")).toBe(true);
    expect(looksAlike("Cidade", "code")).toBe(true);
    expect(looksAlike("cid", "code")).toBe(false);
    expect(looksAlike("card-cid", "code")).toBe(false);
    expect(looksAlike("cardCid", "code")).toBe(false);
    expect(looksAlike("cvc", "code")).toBe(false);
  });

  it("never takes card-m inside another word for the month", () => {
    expect(looksAlike("Cardmember name", "expMonth")).toBe(true);
    expect(looksAlike("cardmembername", "expMonth")).toBe(true);
    expect(looksAlike("card-m", "expMonth")).toBe(false);
    expect(looksAlike("card_mm", "expMonth")).toBe(false);
    expect(looksAlike("cardMonth", "expMonth")).toBe(false);
    expect(looksAlike("exp-month", "expMonth")).toBe(false);
  });
});

describe("the name on a card, in parts", () => {
  it("is all but the last word, and the last word", () => {
    expect(nameParts("Alice B Example")).toEqual({ given: "Alice B", family: "Example" });
    expect(nameParts("  Alice   Example ")).toEqual({ given: "Alice", family: "Example" });
    expect(nameParts("Cher")).toEqual({ given: "Cher", family: "" });
    expect(nameParts(null)).toEqual({ given: "", family: "" });
  });
});

describe("month and year lists", () => {
  it("finds the month by its name first, then its value, then its number", () => {
    expect(
      monthOption(
        [
          ["march", "2"],
          ["april", "3"],
        ],
        "3",
      ),
    ).toBe("2");
    expect(monthOption([["mar", "M"]], "03")).toBe("M");
    expect(monthOption([["03march", "x"]], "3")).toBe("x");
    expect(
      monthOption(
        [
          ["", ""],
          ["03", "03"],
        ],
        "3",
      ),
    ).toBe("03");
    expect(monthOption([["three", "3"]], "3")).toBe("3");
    expect(monthOption([["3", "c"]], "3")).toBe("c");
    expect(
      monthOption(
        [
          ["13", "13"],
          ["31", "31"],
        ],
        "3",
      ),
    ).toBeNull();
    expect(monthOption([["march", "3"]], "13")).toBeNull();
  });

  it("finds the year whether the list says 2027 or 27", () => {
    expect(yearOption([["2027", "2027"]], "27")).toBe("2027");
    expect(yearOption([["27", "27"]], "2027")).toBe("27");
    expect(yearOption([["2027", "y27"]], "2027")).toBe("y27");
    expect(yearOption([["2028", "2028"]], "2027")).toBeNull();
    expect(yearOption([["2027", "2027"]], "next")).toBeNull();
  });

  it("tells whether a value chooses an option", () => {
    expect(hasOptionValue([["march", "03"]], "03")).toBe(true);
    expect(hasOptionValue([["march", "03"]], "3")).toBe(false);
  });
});

describe("a phone number in parts", () => {
  it("splits a North American number, with or without +1", () => {
    const parts = {
      "tel-national": "5551234567",
      "tel-area-code": "555",
      "tel-local": "1234567",
      "tel-local-prefix": "123",
      "tel-local-suffix": "4567",
    };
    expect(phoneParts("+1 555-123-4567")).toEqual({ "tel-country-code": "+1", ...parts });
    expect(phoneParts("(555) 123-4567")).toEqual(parts);
    expect(phoneParts("1 555 123 4567")).toEqual(parts);
  });

  it("gives other countries their code and national number only", () => {
    expect(phoneParts("+44 20 7946 0958")).toEqual({
      "tel-country-code": "+44",
      "tel-national": "2079460958",
    });
    expect(phoneParts("020 7946 0958")).toEqual({});
    expect(phoneParts("")).toEqual({});
  });

  it("answers only for fields that ask for a part, and nothing for a part that isn't clear", () => {
    expect(phonePartFor({ autoCompleteType: "tel" }, "+1 555 123 4567")).toBeUndefined();
    expect(phonePartFor({ autoCompleteType: "" }, "+1 555 123 4567")).toBeUndefined();
    expect(phonePartFor({ autoCompleteType: "tel-area-code" }, "+1 555 123 4567")).toBe("555");
    expect(phonePartFor({ autoCompleteType: "tel-extension" }, "+1 555 123 4567")).toBeNull();
    expect(phonePartFor({ autoCompleteType: "tel-area-code" }, "+44 20 7946 0958")).toBeNull();
  });
});
