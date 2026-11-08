// Keykeeper expiration dates. Any item can expire on a date, stored on the item
// as a text custom field named EXPIRES_FIELD_NAME holding an ISO date
// (YYYY-MM-DD). It is a text field, not hidden, because a date isn't secret and
// list views only carry text fields' values, so lists can show badges without
// decrypting every item. Cards also expire on their own expiry month. The days
// to remind on before the date sit beside it the same way (REMIND_FIELD_NAME).

import { FieldType } from "../enums";
import { FieldView } from "../models/view/field.view";

export const EXPIRES_FIELD_NAME = "keykeeper.expires";

/**
 * The days before an item's date to remind on, when they aren't the default:
 * a text field beside the date holding whole days, comma-separated
 * ("90,30,7,1"), each from 1 to 365, or "none". See DESIGN.md, "Reminder
 * days, per item".
 */
export const REMIND_FIELD_NAME = "keykeeper.remind";

/** The days every item is reminded on unless it says otherwise. */
export const DEFAULT_REMIND_DAYS: readonly number[] = [30, 7, 1];

/** The most days ahead a reminder can be. */
export const MAX_REMIND_DAYS = 365;

/** Items count as expiring soon this many days ahead. */
export const EXPIRING_SOON_DAYS = 30;

type FieldLike = { name?: string | null; value?: string | null };
type CardLike = { expMonth?: string | null; expYear?: string | null };
/**
 * An item, as a full view (`card`) or as the SDK's list view, whose card
 * part (`type.card`) carries the expiry the cipher service adds to it
 * (withCardExpirations, below).
 */
export type ItemWithExpiration = {
  fields?: FieldLike[] | null;
  card?: CardLike | null;
  type?: unknown;
};

/** The card part of a full view or of a list view. */
function cardOf(item: ItemWithExpiration): CardLike | null {
  if (item.card != null) {
    return item.card;
  }
  const type = item.type;
  return typeof type === "object" && type != null && "card" in type
    ? ((type as { card: CardLike | null }).card ?? null)
    : null;
}

/**
 * The SDK's list views (every list since web-v2026.10.1) don't carry a card's
 * expiry, which Expiring soon reads. For each card list view, this opens the
 * card in full and copies its month and year (plain values, like its brand)
 * onto the list view's card part. Cards are few, and nothing secret is copied.
 */
export async function withCardExpirations<
  View extends { id?: unknown; type?: unknown; partial?: boolean },
>(views: View[], openCard: (view: View) => Promise<CardLike | null | undefined>): Promise<View[]> {
  for (const view of views) {
    const type = view.type;
    if (view.partial || typeof type !== "object" || type == null || !("card" in type)) {
      continue;
    }
    const card = (type as { card: CardLike | null }).card;
    if (card == null) {
      continue;
    }
    try {
      const full = await openCard(view);
      card.expMonth = full?.expMonth ?? null;
      card.expYear = full?.expYear ?? null;
    } catch {
      // Without its expiry, the card just doesn't count as expiring.
    }
  }
  return views;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reads "YYYY-MM-DD" as local midnight, or null when it isn't a real date. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  const match = ISO_DATE.exec(value ?? "");
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

/** The date stored on the item, as "YYYY-MM-DD", when there is a valid one. */
export function storedExpiration(item: ItemWithExpiration): string | null {
  const value = (item.fields ?? []).find((f) => f.name === EXPIRES_FIELD_NAME)?.value ?? null;
  return parseIsoDate(value) ? value : null;
}

/** Sets or clears the stored date. The caller saves the item. */
export function setStoredExpiration(
  cipher: { fields?: FieldView[] },
  isoDate: string | null,
): void {
  const others = (cipher.fields ?? []).filter((f) => f.name !== EXPIRES_FIELD_NAME);
  if (!parseIsoDate(isoDate)) {
    cipher.fields = others;
    return;
  }
  const field = new FieldView();
  field.name = EXPIRES_FIELD_NAME;
  field.type = FieldType.Text;
  field.value = isoDate!;
  cipher.fields = [...others, field];
}

/**
 * Reminder days as stored: the days, largest first, or "none". Null when the
 * value isn't one, which counts as the default.
 */
export function parseRemindDays(value: string | null | undefined): number[] | "none" | null {
  const text = (value ?? "").trim();
  if (text.toLowerCase() === "none") {
    return "none";
  }
  const parts = text.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null;
  }
  const days = [...new Set(parts.map(Number))];
  if (days.some((day) => day < 1 || day > MAX_REMIND_DAYS)) {
    return null;
  }
  return days.sort((a, b) => b - a);
}

/** The reminder days as they'd be stored, or null for the default. */
export function remindValue(days: readonly number[] | "none"): string | null {
  if (days === "none") {
    return "none";
  }
  const canonical = parseRemindDays(days.join(","));
  if (canonical == null || canonical === "none") {
    return null;
  }
  return canonical.join(",") === DEFAULT_REMIND_DAYS.join(",") ? null : canonical.join(",");
}

/** The reminder days stored on the item, as stored, when there's a valid value. */
export function storedRemind(item: ItemWithExpiration): string | null {
  const value = (item.fields ?? []).find((f) => f.name === REMIND_FIELD_NAME)?.value ?? null;
  const days = parseRemindDays(value);
  return days == null ? null : remindValue(days);
}

/**
 * The days before its date to remind about an item on, largest first, or
 * null when it says not to remind at all. Every list also reminds once the
 * item has expired.
 */
export function remindDays(item: ItemWithExpiration): number[] | null {
  const days = parseRemindDays(
    (item.fields ?? []).find((f) => f.name === REMIND_FIELD_NAME)?.value ?? null,
  );
  return days === "none" ? null : (days ?? [...DEFAULT_REMIND_DAYS]);
}

/**
 * Sets the reminder days (a value as `remindValue` gives it), or clears them
 * back to the default with null. The caller saves the item.
 */
export function setStoredRemind(cipher: { fields?: FieldView[] }, value: string | null): void {
  const others = (cipher.fields ?? []).filter((f) => f.name !== REMIND_FIELD_NAME);
  const days = parseRemindDays(value);
  const stored = days == null ? null : remindValue(days);
  if (stored == null) {
    cipher.fields = others;
    return;
  }
  const field = new FieldView();
  field.name = REMIND_FIELD_NAME;
  field.type = FieldType.Text;
  field.value = stored;
  cipher.fields = [...others, field];
}

/** A card expires at the end of its expiry month. */
export function cardExpiration(card: CardLike | null | undefined): Date | null {
  const month = Number(card?.expMonth);
  let year = Number(card?.expYear);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year <= 0) {
    return null;
  }
  if (year < 100) {
    year += 2000;
  }
  return new Date(year, month, 0); // day 0 of the next month: the last day of this one
}

/** When the item expires: its stored date, else a card's expiry, else never. */
export function itemExpiration(item: ItemWithExpiration | null | undefined): Date | null {
  if (!item) {
    return null;
  }
  return parseIsoDate(storedExpiration(item)) ?? cardExpiration(cardOf(item));
}

export type ExpirationStatus = {
  state: "expired" | "today" | "soon" | "later";
  /** Whole days from today to the expiry date; negative once expired. */
  days: number;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function expirationStatus(expires: Date, today: Date = new Date()): ExpirationStatus {
  const days = Math.round(
    (startOfDay(expires).getTime() - startOfDay(today).getTime()) / (24 * 60 * 60 * 1000),
  );
  const state =
    days < 0 ? "expired" : days === 0 ? "today" : days <= EXPIRING_SOON_DAYS ? "soon" : "later";
  return { state, days };
}

/** Whether an item has expired or expires within EXPIRING_SOON_DAYS. */
export function isExpiringSoon(
  item: ItemWithExpiration | null | undefined,
  today: Date = new Date(),
): boolean {
  const expires = itemExpiration(item);
  return expires != null && expirationStatus(expires, today).state !== "later";
}

// English until Keykeeper's own strings are translated.
export function expirationLabel({ state, days }: ExpirationStatus): string {
  switch (state) {
    case "expired":
      return days === -1 ? "Expired yesterday" : `Expired ${-days} days ago`;
    case "today":
      return "Expires today";
    default:
      return days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
  }
}

/** Badge colors for a status, in the component library's variants. */
export function expirationBadgeVariant(status: ExpirationStatus): "danger" | "warning" | "subtle" {
  return status.state === "expired" ? "danger" : status.state === "later" ? "subtle" : "warning";
}
