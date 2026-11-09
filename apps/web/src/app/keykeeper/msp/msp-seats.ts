// Keykeeper: seats by client, for MSPs that bill each client for its own
// (GET /keykeeper/msp/<id>/seats on the server, MSP admins only). The server
// counts once a day and today live, and seats are billed by the day: a
// client's seat-days over the days in the month. See DESIGN.md, "Seats by
// client".

import { ApiService } from "@bitwarden/common/abstractions/api.service";

/** One client's seats in a month. */
export type MspClientSeats = {
  id: string;
  /** Its name on its last day that month (today's, for a client now). */
  name: string;
  /** Whether it's a client now. */
  current: boolean;
  /** Its seats on each day the month counts, added up. */
  seatDays: number;
  /** Its seat-days over the days in the month, to two decimals: what it's billed on. */
  prorated: number;
  /** Its peak: its most seats on any day, for reference. */
  most: number;
  /** Today's, this month only and only for a client now. */
  today: number | null;
};

export type MspSeats = {
  /** `YYYY-MM`. */
  month: string;
  thisMonth: boolean;
  /** This month and earlier months with figures, newest first. */
  months: string[];
  /** 28 to 31: what seat-days are divided by, even while the month runs. */
  daysInMonth: number;
  /** The last day counted, `YYYY-MM-DD`: today in this month, the month's last day before. */
  through: string;
  clients: MspClientSeats[];
  totals: { seatDays: number; prorated: number; most: number; today: number | null };
};

/** What the console says counts as a seat. */
export const WHAT_COUNTS =
  "A seat is each person in a client who has joined, counted at the end of each day (UTC). People who've been invited but haven't joined don't count, and neither do your staff.";

/** How a month's seats are billed, with its own number of days. */
export function howBilled(seats: Pick<MspSeats, "month" | "daysInMonth">): string {
  return `Prorated seats are a client's seat-days (its seats each day, added up) divided by the ${seats.daysInMonth} days in ${monthLabel(seats.month, "month")}, so a seat added late in the month counts only for its days. Peak is the most seats on any day, for reference.`;
}

const query = (month?: string, format?: "csv") => {
  const params = new URLSearchParams();
  if (month) {
    params.set("month", month);
  }
  if (format) {
    params.set("format", format);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
};

/** A month's seats by client (this month without one). */
export function getMspSeats(api: ApiService, mspId: string, month?: string): Promise<MspSeats> {
  return api.send("GET", `/keykeeper/msp/${mspId}/seats${query(month)}`, null, true, true);
}

/** The same month as the server's CSV. */
export function getMspSeatsCsv(api: ApiService, mspId: string, month: string): Promise<string> {
  return api.send("GET", `/keykeeper/msp/${mspId}/seats${query(month, "csv")}`, null, true, true);
}

/**
 * The CSV as a file: the server starts it with a byte order mark, so
 * spreadsheets read names with accents right, which reading the response as
 * text drops; put it back once.
 */
export function seatsCsvFile(csv: string): string {
  return csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
}

/** "November 2026" for "2026-11", or "November" alone. */
export function monthLabel(month: string, only?: "month"): string {
  const [year, number] = month.split("-").map(Number);
  if (!year || !number) {
    return month;
  }
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    ...(only ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** "November 8" for "2026-11-08". */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return day;
  }
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Prorated seats as the console shows them: always two decimals, as the server rounds them. */
export function proratedText(prorated: number): string {
  return prorated.toFixed(2);
}
