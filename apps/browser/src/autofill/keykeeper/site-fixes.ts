// Keykeeper: site fixes, for people who chose to share. A fix is a fill rule
// without anything personal: the site's host, how to recognize the field, and
// which kind of value goes there (username, password, one-time code, or
// never). The extension downloads every fix that applies on its server (the
// ones enough people shared, and its MSPs' site rules) and matches them on the
// device, so it never tells the server which sites the person visits. See
// DESIGN.md, "Site fixes (opt-in)".

import { distinctUntilChanged, filter, firstValueFrom, map, of, switchMap } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import {
  KEYKEEPER_SITE_FIXES_DISK,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { UserId } from "@bitwarden/common/types/guid";
import { schemeOf } from "@bitwarden/common/vault/keykeeper/fill-rules";

import { BrowserApi } from "../../platform/browser/browser-api";


import { FieldFingerprint, FillRule, hostOf, schemeOfUrl } from "./fill-rules";

export type FixFill = "username" | "password" | "totp" | "never";
export type SiteFix = {
  host: string;
  field: { id: string; name: string; label: string };
  fill: FixFill;
};
type FixList = { fixes: SiteFix[]; rules: SiteFix[]; fetchedAt: number };

const KINDS: FixFill[] = ["username", "password", "totp", "never"];

/** Whether the person shares the fixes they make with the fill picker. Off until they turn it on. */
export const SHARE_SITE_FIXES = new UserKeyDefinition<boolean>(KEYKEEPER_SITE_FIXES_DISK, "share", {
  deserializer: (share) => share === true,
  clearOn: [],
});

/**
 * Whether fixes other people shared (and the person's MSPs' site rules) fill
 * for this person. On until they turn it off; off, the list isn't downloaded.
 */
export const USE_SITE_FIXES = new UserKeyDefinition<boolean>(KEYKEEPER_SITE_FIXES_DISK, "use", {
  deserializer: (use) => use !== false,
  clearOn: [],
});

/** The most of a field's id, name, or label the server keeps. */
const MAX_TEXT = 200;
const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
// Seven or more digits, with the separators phone numbers are written with.
const PHONE = /\+?\d(?:[\s().-]*\d){6,}/g;

/**
 * Whether page text carries something personal: an email address anywhere,
 * or a phone number in a label (a placeholder or an aria label can say "Code
 * sent to +1 555 010 1234"). Ids and names often have long numbers, which
 * aren't someone's.
 */
export function hasPersonal(text: string, kind: "label" | "id"): boolean {
  // Longer than any field's text the server keeps: not worth the search.
  if (text.length > MAX_TEXT) {
    return true;
  }
  EMAIL.lastIndex = 0;
  PHONE.lastIndex = 0;
  return EMAIL.test(text) || (kind === "label" && PHONE.test(text));
}

/** Page text with any email address or (in a label) phone number replaced by what it was. */
export function scrubPersonal(text: string, kind: "label" | "id"): string {
  const scrubbed = text.slice(0, MAX_TEXT).replace(EMAIL, "(email address)");
  return kind === "label" ? scrubbed.replace(PHONE, "(phone number)") : scrubbed;
}

const FIX_LIST = new UserKeyDefinition<FixList | null>(KEYKEEPER_SITE_FIXES_DISK, "list", {
  deserializer: (list) => list ?? null,
  clearOn: ["logout"],
});

export const SITE_FIXES_ALARM = "keykeeper-site-fixes";
const REFRESH_MINUTES = 24 * 60;

/**
 * A rule as a fix, or null when it can't be one: a custom field, no site, a
 * site that isn't https (fixes fill only there), or a field known only by
 * something personal. A label with an email address or phone number is left
 * out; an id or name with an email address keeps the whole fix on the device.
 */
export function toFix(rule: FillRule): SiteFix | null {
  const fill = rule.fill.from;
  if (
    rule.host == null ||
    rule.host === "" ||
    schemeOf(rule) !== "https" ||
    !KINDS.includes(fill as FixFill)
  ) {
    return null;
  }
  const label = rule.field.label ?? "";
  const field = {
    id: rule.field.id ?? "",
    name: rule.field.name ?? "",
    label: hasPersonal(label, "label") ? "" : label,
  };
  if (hasPersonal(field.id, "id") || hasPersonal(field.name, "id")) {
    return null;
  }
  if (field.id === "" && field.name === "" && field.label === "") {
    return null;
  }
  return { host: rule.host, field, fill: fill as FixFill };
}

/** A fix as a fill rule, with the same limits as the person's own rules. */
export function toRule(fix: SiteFix): FillRule | null {
  if (!KINDS.includes(fix.fill) || typeof fix.host !== "string" || fix.host === "") {
    return null;
  }
  const field: FieldFingerprint = {};
  if (fix.field?.id) {
    field.id = fix.field.id;
  }
  if (fix.field?.name) {
    field.name = fix.field.name;
  }
  if (fix.field?.label) {
    field.label = fix.field.label;
  }
  if (Object.keys(field).length === 0) {
    return null;
  }
  return { v: 1, host: fix.host, field, fill: { from: fix.fill } as FillRule["fill"] };
}

export class KeykeeperSiteFixes {
  /** The downloaded list, so turning fixes off can drop it. */
  static readonly LIST = FIX_LIST;

  constructor(
    private readonly apiService: ApiService,
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly stateProvider: StateProvider,
  ) {}

  /** Downloads the list when someone unlocks, and once a day. */
  init() {
    this.accountService.activeAccount$
      .pipe(
        getOptionalUserId,
        switchMap((userId) =>
          userId == null
            ? of(null)
            : this.authService
                .authStatusFor$(userId)
                .pipe(map((status) => (status === AuthenticationStatus.Unlocked ? userId : null))),
        ),
        distinctUntilChanged(),
        filter((userId): userId is UserId => userId != null),
      )
      .subscribe((userId) => void this.refresh(userId));
    if (chrome.alarms) {
      BrowserApi.addListener(chrome.alarms.onAlarm, (alarm: chrome.alarms.Alarm) => {
        if (alarm.name === SITE_FIXES_ALARM) {
          void this.refreshActive();
        }
      });
      void chrome.alarms.create(SITE_FIXES_ALARM, { periodInMinutes: REFRESH_MINUTES });
    }
  }

  private async activeUser(): Promise<UserId | null> {
    return firstValueFrom(this.accountService.activeAccount$.pipe(getOptionalUserId));
  }

  async refreshActive() {
    const userId = await this.activeUser();
    if (
      userId != null &&
      (await firstValueFrom(this.authService.authStatusFor$(userId))) ===
        AuthenticationStatus.Unlocked
    ) {
      await this.refresh(userId);
    }
  }

  private async using(userId: UserId): Promise<boolean> {
    return (await firstValueFrom(this.stateProvider.getUser(userId, USE_SITE_FIXES).state$)) !== false;
  }

  /**
   * The whole list from the server. A server without site fixes leaves none,
   * and so does someone who turned them off.
   */
  async refresh(userId: UserId) {
    if (!(await this.using(userId))) {
      await this.stateProvider.getUser(userId, FIX_LIST).update(() => null);
      return;
    }
    try {
      const list = await this.apiService.send("GET", "/keykeeper/site-fixes", null, true, true);
      await this.stateProvider.getUser(userId, FIX_LIST).update(() => ({
        fixes: Array.isArray(list?.fixes) ? list.fixes : [],
        rules: Array.isArray(list?.rules) ? list.rules : [],
        fetchedAt: Date.now(),
      }));
    } catch {
      // Offline or an older server: keep what we had.
    }
  }

  /**
   * The fixes for the page at `url`: its MSPs' rules first, then the confirmed
   * ones. Only on https pages, and none for someone who turned them off.
   */
  async rulesFor(url: string): Promise<FillRule[]> {
    const userId = await this.activeUser();
    const host = hostOf(url);
    if (userId == null || host === "" || schemeOfUrl(url) !== "https") {
      return [];
    }
    if (!(await this.using(userId))) {
      return [];
    }
    const list = await firstValueFrom(this.stateProvider.getUser(userId, FIX_LIST).state$);
    return [...(list?.rules ?? []), ...(list?.fixes ?? [])]
      .filter((fix) => fix.host === host)
      .map(toRule)
      .filter((rule): rule is FillRule => rule != null);
  }

  /** Shares a rule the person made, if they chose to share and it can be a fix. */
  async share(rule: FillRule): Promise<void> {
    const userId = await this.activeUser();
    const fix = toFix(rule);
    if (userId == null || fix == null) {
      return;
    }
    if (!(await firstValueFrom(this.stateProvider.getUser(userId, SHARE_SITE_FIXES).state$))) {
      return;
    }
    await this.apiService.send("POST", "/keykeeper/site-fixes", fix, true, true);
  }
}
