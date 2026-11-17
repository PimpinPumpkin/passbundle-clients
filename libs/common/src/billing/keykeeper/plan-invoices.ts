/**
 * Keykeeper: the months a plan billed by the day was invoiced for, as the
 * server worked them out and keeps them (`GET /api/keykeeper/plan/invoices`;
 * DESIGN.md, "Plans and billing", "Learning who has paid"), and the Plan
 * page's list of them in words. Nothing here works out a figure: each is the
 * server's, which it worked out with the seat report's own arithmetic.
 */
import { KeykeeperPlanEnforced } from "./keykeeper-plan";
import { billedByTheDay, PlanWhose, Translate } from "./plan-words";

/** One month's invoice. */
export type KeykeeperPlanInvoice = {
  /** `YYYY-MM`, UTC. */
  month: string;
  /** The month's seat-days that were billed: days before a free period ended aren't. */
  seatDays: number;
  /** How many of the month's days weren't billed. */
  freeDays: number;
  /** 28 to 31: what the seat-days are divided by. */
  daysInMonth: number;
  /** Seat-days over the days in the month, to two decimals. */
  prorated: number;
  /** The price a seat for the month's tier, in cents. */
  priceCents: number;
  /** Prorated seats times the price, in cents. */
  amountCents: number;
  /** ISO 4217, lowercase, as the server says it: `usd`. */
  currency: string;
  /** Whether the payment provider has it yet. */
  state: "invoiced" | "pending";
};

const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * The invoices as the server sent them. One that doesn't read is left out,
 * and an answer that isn't a list is none.
 */
export function planInvoicesFrom(value: unknown): KeykeeperPlanInvoice[] {
  const list = (value as { invoices?: unknown } | null)?.invoices;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((item): KeykeeperPlanInvoice[] => {
    const v = (item ?? {}) as Record<string, unknown>;
    if (
      typeof v.month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month) ||
      !whole(v.seatDays) ||
      !whole(v.freeDays) ||
      !whole(v.daysInMonth) ||
      typeof v.prorated !== "number" ||
      !Number.isFinite(v.prorated) ||
      v.prorated < 0 ||
      !whole(v.priceCents) ||
      !whole(v.amountCents) ||
      typeof v.currency !== "string" ||
      !/^[a-z]{3}$/.test(v.currency) ||
      (v.state !== "invoiced" && v.state !== "pending")
    ) {
      return [];
    }
    return [
      {
        month: v.month,
        seatDays: v.seatDays,
        freeDays: v.freeDays,
        daysInMonth: v.daysInMonth,
        prorated: v.prorated,
        priceCents: v.priceCents,
        amountCents: v.amountCents,
        currency: v.currency,
        state: v.state,
      },
    ];
  });
}

/**
 * Whether the Plan page lists the plan's invoices: one billed by the day,
 * for whoever may pay for it, which `canPay` says.
 */
export function listsInvoices(plan: KeykeeperPlanEnforced, whose: PlanWhose): boolean {
  return plan.canPay && plan.canManage && billedByTheDay(plan, whose);
}

/** One invoice as the Plan page's list shows it, each figure in words. */
export type InvoiceRow = {
  month: string;
  seatDays: string;
  /** "9 of 30 days free", or null when every day was billed. */
  freeDays: string | null;
  prorated: string;
  price: string;
  amount: string;
  state: string;
};

/** Money in a locale: "$1.50". An unknown locale falls back to US English. */
function money(locale: string | undefined, currency: string): (cents: number) => string {
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() });
  } catch {
    format = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    });
  }
  return (cents) => format.format(cents / 100);
}

/** "November 2026", for a month the server names `2026-11`. */
function monthInWords(locale: string | undefined, month: string): string {
  const [year, number] = month.split("-").map(Number);
  const at = new Date(Date.UTC(year, number - 1, 1));
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(at);
  }
}

/** The invoices in words, newest first as the server lists them. */
export function invoiceRows(
  invoices: KeykeeperPlanInvoice[],
  t: Translate,
  locale?: string,
): InvoiceRow[] {
  return invoices.map((invoice) => {
    const inMoney = money(locale, invoice.currency);
    return {
      month: monthInWords(locale, invoice.month),
      seatDays: String(invoice.seatDays),
      freeDays:
        invoice.freeDays > 0
          ? t("keykeeperPlanInvoiceFreeDays", String(invoice.freeDays), String(invoice.daysInMonth))
          : null,
      prorated: invoice.prorated.toFixed(2),
      price: inMoney(invoice.priceCents),
      amount: inMoney(invoice.amountCents),
      state: t(
        invoice.state === "invoiced" ? "keykeeperPlanInvoiceSent" : "keykeeperPlanInvoicePending",
      ),
    };
  });
}
