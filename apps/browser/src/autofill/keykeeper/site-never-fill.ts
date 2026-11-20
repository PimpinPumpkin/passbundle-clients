// Keykeeper: "Never fill this field on this site", for every item. The fill
// picker (fill-field-menu.ts) adds one; fill rules (fill-rules.ts) hold every
// item back from that field on that site; the extension's Autofill settings
// list them and remove one. See DESIGN.md, "Choosing what fills where".
//
// Where they live: in the account's settings document, the one the
// generator's settings already keep on the server encrypted with the
// account's key (`/api/keykeeper/settings`, KeykeeperGeneratorSettingsSync),
// as its `fill` part: `{"neverFill": "<the list, encrypted with the account's
// key>"}`. The list is encrypted once more on its own, so the copy kept on
// the device (here, and in the settings sync's own copy of the document) is
// encrypted too, as the vault is: it names sites the person uses. Opening it
// needs the account unlocked, which filling needs anyway.

import { combineLatest, firstValueFrom, from, map, Observable, of, switchMap } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import {
  KEYKEEPER_FILL_DISK,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { UserId } from "@bitwarden/common/types/guid";
import { isFillRule, sameRuleTarget } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { KeykeeperSyncedPart, keykeeperSettingsText } from "@bitwarden/generator-core";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString } from "@bitwarden/legacy-crypto";

import { FillRule, ruleAppliesOn } from "./fill-rules";

/**
 * The list, encrypted with the account's key, as the settings document has
 * it. Kept across sign-outs, as the settings sync keeps its copy: it can't be
 * read without the account's key, and a person who signs in again has their
 * never-fill fields at once, before the first sync.
 */
export const SITE_NEVER_FILL = new UserKeyDefinition<string | null>(
  KEYKEEPER_FILL_DISK,
  "siteNeverFill",
  {
    deserializer: (value) => (typeof value === "string" ? value : null),
    clearOn: [],
  },
);

/** The settings document's part for them. */
export const SITE_NEVER_FILL_PART = "fill";

/**
 * The most the list takes, as text before it's encrypted: with both
 * encryptions it stays well inside the 16 KB the server keeps for the whole
 * document, beside the generator's settings. Some 60 fields.
 */
export const MAX_LIST_TEXT = 4000;

/** Rules as the list keeps them: site-wide, never-fill, with a site. */
function onlyNeverFill(value: unknown): FillRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (rule): rule is FillRule =>
      isFillRule(rule) &&
      rule.fill.from === "never" &&
      typeof rule.host === "string" &&
      rule.host !== "",
  );
}

export class KeykeeperSiteNeverFill {
  /** The last list opened, by its encrypted text, so filling doesn't decrypt it each time. */
  private opened: { userId: UserId; data: string; rules: FillRule[] } | null = null;
  /** Changes one at a time, so two picks at once both stay. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly stateProvider: StateProvider,
    private readonly keyService: KeyService,
    private readonly encryptService: EncryptService,
    private readonly accountService: AccountService,
  ) {}

  private state(userId: UserId) {
    return this.stateProvider.getUser(userId, SITE_NEVER_FILL);
  }

  private async activeUser(): Promise<UserId | null> {
    return firstValueFrom(this.accountService.activeAccount$.pipe(getOptionalUserId));
  }

  /** The list in an encrypted text, or null when the account's key can't open it (or it's locked). */
  async open(userId: UserId, data: string | null): Promise<FillRule[] | null> {
    if (data == null) {
      return [];
    }
    const key = await firstValueFrom(this.keyService.userKey$(userId));
    if (key == null) {
      // Locked: what was opened goes too.
      this.opened = null;
      return null;
    }
    if (this.opened?.userId === userId && this.opened.data === data) {
      return this.opened.rules;
    }
    try {
      const rules = onlyNeverFill(
        JSON.parse(await this.encryptService.decryptString(new EncString(data), key)),
      );
      this.opened = { userId, data, rules };
      return rules;
    } catch {
      return null;
    }
  }

  /** The person's site-wide never-fill rules; none while the list can't be opened. */
  async list(userId: UserId): Promise<FillRule[]> {
    return (await this.open(userId, await firstValueFrom(this.state(userId).state$))) ?? [];
  }

  /** The rules for the page at `url`, for whoever is signed in: same scheme, host, and port. */
  async rulesFor(url: string): Promise<FillRule[]> {
    const userId = await this.activeUser();
    if (userId == null) {
      return [];
    }
    return (await this.list(userId)).filter((rule) => ruleAppliesOn(rule, url));
  }

  /**
   * Changes the list, one change at a time. Answers false when nothing was
   * saved. The popup and the background each change it; a change made
   * meanwhile in the other is read again, never written over.
   */
  private change(userId: UserId, edit: (rules: FillRule[]) => FillRule[] | null): Promise<boolean> {
    const next = this.queue.then(async () => {
      const state = this.state(userId);
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await firstValueFrom(state.state$);
        const rules = await this.open(userId, before);
        // A list this account's key can't open (or a locked account): left alone.
        if (rules == null) {
          return false;
        }
        const edited = edit(rules);
        if (edited == null) {
          return false;
        }
        const text = JSON.stringify(edited);
        if (text.length > MAX_LIST_TEXT) {
          return false;
        }
        const key = await firstValueFrom(this.keyService.userKey$(userId));
        if (key == null) {
          return false;
        }
        const data = (await this.encryptService.encryptString(text, key)).encryptedString;
        if (data == null) {
          return false;
        }
        const saved = await state.update(() => data, { shouldUpdate: (now) => now === before });
        if (saved === data) {
          this.opened = { userId, data, rules: edited };
          return true;
        }
      }
      return false;
    });
    this.queue = next.catch(() => false);
    return next;
  }

  /**
   * Adds a site-wide never-fill rule, replacing one for the same field on the
   * same site. Answers false when the list is full, or can't be opened.
   */
  async add(rule: FillRule, userId?: UserId): Promise<boolean> {
    const user = userId ?? (await this.activeUser());
    if (user == null || rule.fill.from !== "never" || !rule.host) {
      return false;
    }
    return this.change(user, (rules) => [...rules.filter((r) => !sameRuleTarget(r, rule)), rule]);
  }

  /** Removes the rule for the same field on the same site, if there is one. */
  async remove(rule: FillRule, userId?: UserId): Promise<void> {
    const user = userId ?? (await this.activeUser());
    if (user == null) {
      return;
    }
    await this.change(user, (rules) =>
      rules.some((r) => sameRuleTarget(r, rule))
        ? rules.filter((r) => !sameRuleTarget(r, rule))
        : null,
    );
  }

  /**
   * The list's part of the account's settings document, for the settings
   * sync, so it follows the account to each of its browsers. Its value is the
   * encrypted list, so the sync compares and keeps it as it is. A change here
   * the server hasn't got goes back; otherwise the server's is taken. Last
   * save wins, as for the rest of the settings.
   */
  syncedPart(): KeykeeperSyncedPart {
    const value = (data: string | null) => (data == null ? {} : { neverFill: data });
    return {
      name: SITE_NEVER_FILL_PART,
      here$: (userId: UserId): Observable<{ value: Record<string, unknown>; chosen: boolean }> =>
        combineLatest([this.state(userId).state$, this.keyService.userKey$(userId)]).pipe(
          switchMap(([data]) =>
            data == null
              ? of({ value: {}, chosen: false })
              : from(this.open(userId, data)).pipe(
                  // One this account's key can't open (from before its key
                  // changed) isn't sent anywhere.
                  map((rules) =>
                    rules == null
                      ? { value: {}, chosen: false }
                      : { value: value(data), chosen: true },
                  ),
                ),
          ),
        ),
      take: async (userId: UserId, part: unknown, seen: string | undefined) => {
        const remote = (part as { neverFill?: unknown } | null)?.neverFill;
        const state = this.state(userId);
        const current = await firstValueFrom(state.state$);
        if (typeof remote !== "string" || (await this.open(userId, remote)) == null) {
          // The server has none this account can open: this device's goes up, if it has one.
          return current == null || (await this.open(userId, current)) == null;
        }
        if (remote === current) {
          return true;
        }
        // Changed here since this app last took or saved it: this device's goes back.
        if (
          current != null &&
          seen !== undefined &&
          keykeeperSettingsText(value(current)) !== seen
        ) {
          return false;
        }
        await state.update(() => remote, { shouldUpdate: (now) => now === current });
        return true;
      },
    };
  }
}
