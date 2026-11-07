// Keykeeper: seats by client, for MSPs that bill each client for its own
// (GET /keykeeper/msp/<id>/seats on the server, MSP admins only). The server
// counts once a day and today live; see DESIGN.md, "Seats by client".

import { ApiService } from "@bitwarden/common/abstractions/api.service";

/** One client's seats in a month. */
export type MspClientSeats = {
  id: string;
  /** Its name on its last day that month (today's, for a client now). */
  name: string;
  /** Whether it's a client now. */
  current: boolean;
  /** Its most seats on any day. */
  most: number;
  /** Its average over the days the month counts, to one decimal. */
  average: number;
  /** Today's, this month only and only for a client now. */
  today: number | null;
};

export type MspSeats = {
  /** `YYYY-MM`. */
  month: string;
  thisMonth: boolean;
  /** This month and earlier months with figures, newest first. */
  months: string[];
  /** The days the figures cover. */
  days: number;
  clients: MspClientSeats[];
  totals: { most: number; average: number; today: number | null };
};

/** What the console says counts as a seat. */
export const WHAT_COUNTS =
  "A seat is each person in a client who has joined, counted once a day. People who've been invited but haven't joined don't count, and neither do your staff.";

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

/** "November 2026" for "2026-11". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  if (!year || !number) {
    return month;
  }
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** An average as the console shows it: always one decimal. */
export function averageText(average: number): string {
  return average.toFixed(1);
}
