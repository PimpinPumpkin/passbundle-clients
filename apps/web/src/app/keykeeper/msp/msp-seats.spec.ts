import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import {
  dayLabel,
  getMspSeats,
  getMspSeatsCsv,
  howBilled,
  monthLabel,
  proratedText,
  seatsCsvFile,
  WHAT_COUNTS,
} from "./msp-seats";

describe("MSP seats", () => {
  it("asks for this month without a month, and for a chosen month by name", async () => {
    const api = mock<ApiService>();
    api.send.mockResolvedValue({});
    await getMspSeats(api, "msp-1");
    await getMspSeats(api, "msp-1", "2026-10");
    await getMspSeatsCsv(api, "msp-1", "2026-10");
    expect(api.send.mock.calls.map((c) => [c[0], c[1], c[3], c[4]])).toEqual([
      ["GET", "/keykeeper/msp/msp-1/seats", true, true],
      ["GET", "/keykeeper/msp/msp-1/seats?month=2026-10", true, true],
      ["GET", "/keykeeper/msp/msp-1/seats?month=2026-10&format=csv", true, true],
    ]);
  });

  it("keeps the CSV's byte order mark, once", () => {
    expect(seatsCsvFile("Month,Client\r\n")).toBe("\uFEFFMonth,Client\r\n");
    expect(seatsCsvFile("\uFEFFMonth,Client\r\n")).toBe("\uFEFFMonth,Client\r\n");
  });

  it("names months and days, and shows prorated seats with two decimals", () => {
    expect(monthLabel("2026-11")).toMatch(/November.*2026|2026.*November/);
    expect(monthLabel("2027-01")).toMatch(/January.*2027|2027.*January/);
    expect(monthLabel("2026-11", "month")).toMatch(/November/);
    expect(monthLabel("2026-11", "month")).not.toMatch(/2026/);
    expect(monthLabel("not a month")).toBe("not a month");
    expect(dayLabel("2026-11-08")).toMatch(/November.*8|8.*November/);
    expect(dayLabel("2028-02-29")).toMatch(/February.*29|29.*February/);
    expect(dayLabel("not a day")).toBe("not a day");
    expect(proratedText(10.37)).toBe("10.37");
    expect(proratedText(2)).toBe("2.00");
    expect(proratedText(0.07)).toBe("0.07");
    expect(proratedText(0.1)).toBe("0.10");
  });

  it("says what counts in the site's words, and how a month is billed with its own days", () => {
    expect(WHAT_COUNTS).toContain("People who've been invited but haven't joined don't count");
    expect(WHAT_COUNTS).toContain("neither do your staff");
    expect(WHAT_COUNTS).toContain("counted at the end of each day (UTC)");
    const november = howBilled({ month: "2026-11", daysInMonth: 30 });
    expect(november).toMatch(/divided by the 30 days in November,/);
    expect(november).toContain("a seat added late in the month counts only for its days");
    expect(november).toContain("Peak is the most seats on any day, for reference.");
    expect(howBilled({ month: "2028-02", daysInMonth: 29 })).toMatch(/the 29 days in February,/);
  });
});
