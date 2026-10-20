// Keykeeper: on-device reminders before items expire. The extension checks
// every few hours while the vault is unlocked and shows a browser notification
// at 30, 7, and 1 day before an item expires, and once when it has expired.
// Nothing leaves the device; what was already shown is remembered on it, per
// account and cleared at logout, so each step notifies once.

import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import {
  ExpirationStatus,
  expirationLabel,
  expirationStatus,
  itemExpiration,
} from "@bitwarden/common/vault/keykeeper/expiration";
import { KEYKEEPER_REMINDERS_DISK, StateProvider, UserKeyDefinition } from "@bitwarden/state";

import { BrowserApi } from "../platform/browser/browser-api";

export const REMINDER_ALARM = "keykeeper-expiration-reminders";
/** Where earlier versions kept every account's reminders together. */
const OLD_STORAGE_KEY = "keykeeper.expirationReminders";
const CHECK_EVERY_MINUTES = 6 * 60;

/** How urgent a reminder is, from least to most. */
export type ReminderLevel = "30" | "7" | "1" | "expired";
const LEVEL_ORDER: ReminderLevel[] = ["30", "7", "1", "expired"];

/** The reminder step an item is at, or null when it's more than 30 days out. */
export function reminderLevel(status: ExpirationStatus): ReminderLevel | null {
  if (status.days < 0) {
    return "expired";
  }
  if (status.days <= 1) {
    return "1";
  }
  if (status.days <= 7) {
    return "7";
  }
  if (status.days <= 30) {
    return "30";
  }
  return null;
}

/** What was already shown for an item: its expiry date and the last step. */
export type ShownReminders = Record<string, { date: string; level: ReminderLevel }>;

export const SHOWN_REMINDERS = new UserKeyDefinition<ShownReminders>(
  KEYKEEPER_REMINDERS_DISK,
  "shown",
  { deserializer: (shown) => shown ?? {}, clearOn: ["logout"] },
);

/**
 * Whether to notify: when an item reaches a more urgent step than the last one
 * shown for the same expiry date. A new date starts over.
 */
export function shouldRemind(
  shown: ShownReminders[string] | undefined,
  date: string,
  level: ReminderLevel,
): boolean {
  if (!shown || shown.date !== date) {
    return true;
  }
  return LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(shown.level);
}

const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export class KeykeeperExpirationReminders {
  constructor(
    private authService: AuthService,
    private accountService: AccountService,
    private cipherService: CipherService,
    private stateProvider: StateProvider,
  ) {}

  init() {
    void chrome.storage?.local?.remove(OLD_STORAGE_KEY);
    if (!chrome.alarms) {
      return;
    }
    BrowserApi.addListener(chrome.alarms.onAlarm, (alarm: chrome.alarms.Alarm) => {
      if (alarm.name === REMINDER_ALARM) {
        void this.check();
      }
    });
    void chrome.alarms.create(REMINDER_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: CHECK_EVERY_MINUTES,
    });
  }

  /** Looks for items to remind about and notifies. Returns the titles shown. */
  async check(now: Date = new Date()): Promise<string[]> {
    if ((await this.authService.getAuthStatus()) !== AuthenticationStatus.Unlocked) {
      return [];
    }
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getOptionalUserId));
    if (userId == null) {
      return [];
    }

    const state = this.stateProvider.getUser(userId, SHOWN_REMINDERS);
    const shown: ShownReminders = { ...((await firstValueFrom(state.state$)) ?? {}) };
    const titles: string[] = [];
    for (const cipher of await this.cipherService.getAllDecrypted(userId)) {
      const expires = itemExpiration(cipher);
      if (!cipher.id || cipher.isDeleted || !expires) {
        continue;
      }
      const status = expirationStatus(expires, now);
      const level = reminderLevel(status);
      const date = isoDate(expires);
      if (!level || !shouldRemind(shown[cipher.id], date, level)) {
        continue;
      }
      const title = `${cipher.name}: ${expirationLabel(status).toLowerCase()}`;
      await chrome.notifications.create(`${REMINDER_ALARM}-${cipher.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("images/icon128.png"),
        title,
        message: "Renew or rotate it, then update its expiration date.",
        priority: 1,
      });
      shown[cipher.id] = { date, level };
      titles.push(title);
    }
    await state.update(() => shown);
    return titles;
  }
}
