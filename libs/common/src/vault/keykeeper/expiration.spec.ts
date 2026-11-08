import { FieldType } from "../enums";
import { FieldView } from "../models/view/field.view";

import {
  cardExpiration,
  EXPIRES_FIELD_NAME,
  expirationBadgeVariant,
  expirationLabel,
  expirationStatus,
  isExpiringSoon,
  itemExpiration,
  parseIsoDate,
  parseRemindDays,
  REMIND_FIELD_NAME,
  remindDays,
  remindValue,
  setStoredExpiration,
  setStoredRemind,
  storedExpiration,
  storedRemind,
  withCardExpirations,
} from "./expiration";

const field = (name: string, value: string) => {
  const f = new FieldView();
  f.name = name;
  f.value = value;
  return f;
};

describe("Keykeeper expiration dates", () => {
  describe("parseIsoDate", () => {
    it("reads a date as local midnight", () => {
      expect(parseIsoDate("2026-10-30")).toEqual(new Date(2026, 9, 30));
    });

    it("rejects anything that isn't a real calendar date", () => {
      expect(parseIsoDate("2026-02-30")).toBeNull();
      expect(parseIsoDate("2026-13-01")).toBeNull();
      expect(parseIsoDate("30/10/2026")).toBeNull();
      expect(parseIsoDate("")).toBeNull();
      expect(parseIsoDate(null)).toBeNull();
    });
  });

  describe("storing", () => {
    it("adds, replaces, and clears the stored date, as a text field", () => {
      const cipher = { fields: [field("Customer ID", "C-1")] };

      setStoredExpiration(cipher, "2026-10-30");
      setStoredExpiration(cipher, "2027-01-15");

      expect(storedExpiration(cipher)).toBe("2027-01-15");
      expect(cipher.fields.map((f) => f.name)).toEqual(["Customer ID", EXPIRES_FIELD_NAME]);
      expect(cipher.fields[1].type).toBe(FieldType.Text);

      setStoredExpiration(cipher, null);
      expect(storedExpiration(cipher)).toBeNull();
      expect(cipher.fields.map((f) => f.name)).toEqual(["Customer ID"]);
    });

    it("treats an invalid date as no date", () => {
      const cipher = { fields: [] as FieldView[] };

      setStoredExpiration(cipher, "2026-02-30");

      expect(cipher.fields).toEqual([]);
      expect(storedExpiration({ fields: [field(EXPIRES_FIELD_NAME, "soon")] })).toBeNull();
    });
  });

  describe("cards", () => {
    it("expire at the end of their expiry month, with two- or four-digit years", () => {
      expect(cardExpiration({ expMonth: "2", expYear: "2028" })).toEqual(new Date(2028, 1, 29));
      expect(cardExpiration({ expMonth: "12", expYear: "30" })).toEqual(new Date(2030, 11, 31));
    });

    it("have no expiry when the month or year is missing or invalid", () => {
      expect(cardExpiration({ expMonth: "", expYear: "2030" })).toBeNull();
      expect(cardExpiration({ expMonth: "13", expYear: "2030" })).toBeNull();
      expect(cardExpiration({ expMonth: "1", expYear: null })).toBeNull();
      expect(cardExpiration(null)).toBeNull();
    });
  });

  describe("itemExpiration", () => {
    it("prefers the stored date over a card's own expiry", () => {
      expect(
        itemExpiration({
          fields: [field(EXPIRES_FIELD_NAME, "2026-11-01")],
          card: { expMonth: "12", expYear: "2030" },
        }),
      ).toEqual(new Date(2026, 10, 1));
      expect(itemExpiration({ fields: [], card: { expMonth: "12", expYear: "2030" } })).toEqual(
        new Date(2030, 11, 31),
      );
      expect(itemExpiration({ fields: [] })).toBeNull();
    });
  });

  describe("status and wording", () => {
    const today = new Date(2026, 9, 14, 15, 30);

    it.each([
      ["2026-10-12", "expired", -2, "Expired 2 days ago", "danger"],
      ["2026-10-13", "expired", -1, "Expired yesterday", "danger"],
      ["2026-10-14", "today", 0, "Expires today", "warning"],
      ["2026-10-15", "soon", 1, "Expires tomorrow", "warning"],
      ["2026-11-13", "soon", 30, "Expires in 30 days", "warning"],
      ["2026-11-14", "later", 31, "Expires in 31 days", "subtle"],
    ])("%s is %s, %i days away", (date, state, days, label, variant) => {
      const status = expirationStatus(parseIsoDate(date)!, today);

      expect(status).toEqual({ state, days });
      expect(expirationLabel(status)).toBe(label);
      expect(expirationBadgeVariant(status)).toBe(variant);
    });

    it("counts expired and within 30 days as expiring soon, and nothing else", () => {
      const on = (date: string) => ({ fields: [field(EXPIRES_FIELD_NAME, date)] });
      expect(isExpiringSoon(on("2026-10-12"), today)).toBe(true);
      expect(isExpiringSoon(on("2026-11-13"), today)).toBe(true);
      expect(isExpiringSoon(on("2026-11-14"), today)).toBe(false);
      expect(isExpiringSoon({ card: { expMonth: "10", expYear: "2026" } }, today)).toBe(true);
      expect(isExpiringSoon({ fields: [] }, today)).toBe(false);
      expect(isExpiringSoon(null, today)).toBe(false);
    });
  });

  describe("reminder days", () => {
    it("reads whole days from 1 to 365 in any order, repeats once, largest first", () => {
      expect(parseRemindDays("90,30,7,1")).toEqual([90, 30, 7, 1]);
      expect(parseRemindDays(" 7, 90 ,7 ")).toEqual([90, 7]);
      expect(parseRemindDays("365")).toEqual([365]);
      expect(parseRemindDays("none")).toBe("none");
      expect(parseRemindDays(" None ")).toBe("none");
    });

    it("treats anything else as the default", () => {
      for (const value of ["", "0", "366", "1.5", "-1", "7,,1", "seven", "1000", null, undefined]) {
        expect(parseRemindDays(value)).toBeNull();
        expect(remindDays({ fields: [field(REMIND_FIELD_NAME, value ?? "")] })).toEqual([30, 7, 1]);
      }
    });

    it("is the default without a field, nothing with none, and the list otherwise", () => {
      expect(remindDays({ fields: [] })).toEqual([30, 7, 1]);
      expect(remindDays({ fields: [field(REMIND_FIELD_NAME, "none")] })).toBeNull();
      expect(remindDays({ fields: [field(REMIND_FIELD_NAME, "1,7")] })).toEqual([7, 1]);
    });

    it("stores only what isn't the default, as a text field, the same way every time", () => {
      expect(remindValue([30, 7, 1])).toBeNull();
      expect(remindValue([1, 30, 7])).toBeNull();
      expect(remindValue([1, 7, 90, 30])).toBe("90,30,7,1");
      expect(remindValue("none")).toBe("none");

      const cipher = { fields: [field("Customer ID", "C-1")] };
      setStoredRemind(cipher, "7,1");
      expect(cipher.fields.map((f) => [f.name, f.value, f.type])).toEqual([
        ["Customer ID", "C-1", FieldType.Text],
        [REMIND_FIELD_NAME, "7,1", FieldType.Text],
      ]);
      expect(storedRemind(cipher)).toBe("7,1");
      setStoredRemind(cipher, "30,7,1");
      expect(cipher.fields.map((f) => f.name)).toEqual(["Customer ID"]);
      setStoredRemind(cipher, "none");
      expect(storedRemind(cipher)).toBe("none");
      setStoredRemind(cipher, null);
      expect(storedRemind(cipher)).toBeNull();
      expect(cipher.fields.map((f) => f.name)).toEqual(["Customer ID"]);
    });
  });

  describe("list views (the SDK's, which lists use since web-v2026.10.1)", () => {
    const today = new Date(2026, 10, 8);

    it("reads a card's expiry from its list view's card part", () => {
      const listView = { type: { card: { brand: "Visa", expMonth: "11", expYear: "2026" } } };
      expect(itemExpiration(listView)).toEqual(new Date(2026, 10, 30));
      expect(isExpiringSoon(listView, today)).toBe(true);
    });

    it("gives card list views their month and year only, from the full card", async () => {
      const card = { id: "card-1", type: { card: { brand: "Visa" } } };
      const login = { id: "login-1", type: { login: { username: "ana" } } };
      const partial = { id: "card-2", partial: true, type: { card: { brand: "Amex" } } };
      const opened: string[] = [];
      await withCardExpirations([card, login, partial], async (view) => {
        opened.push(view.id);
        return { expMonth: "1", expYear: "27", number: "4111111111111111", code: "123" } as any;
      });
      expect(opened).toEqual(["card-1"]);
      expect(card.type.card).toEqual({ brand: "Visa", expMonth: "1", expYear: "27" });
      expect(partial.type.card).toEqual({ brand: "Amex" });
    });

    it("leaves a card it can't open without an expiry", async () => {
      const card = { id: "card-1", type: { card: { brand: "Visa" } } };
      await withCardExpirations([card], async () => {
        throw new Error("no key");
      });
      expect(isExpiringSoon(card, today)).toBe(false);
    });
  });
});
