import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import {
  averageText,
  getMspSeats,
  getMspSeatsCsv,
  monthLabel,
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

  it("names months and shows averages with one decimal", () => {
    expect(monthLabel("2026-11")).toMatch(/November.*2026|2026.*November/);
    expect(monthLabel("2027-01")).toMatch(/January.*2027|2027.*January/);
    expect(monthLabel("not a month")).toBe("not a month");
    expect(averageText(4)).toBe("4.0");
    expect(averageText(4.7)).toBe("4.7");
    expect(averageText(0.3)).toBe("0.3");
  });

  it("says what counts in the site's words", () => {
    expect(WHAT_COUNTS).toContain("People who've been invited but haven't joined don't count");
    expect(WHAT_COUNTS).toContain("neither do your staff");
  });
});
