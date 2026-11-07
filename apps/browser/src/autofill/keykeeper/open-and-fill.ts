// Keykeeper: "Open and fill" (DESIGN.md, "Open and fill"). The open button on
// a login, in the popup's lists and the item view, opens the login's website
// in a new tab and fills it there, once. The fill itself is upstream's
// (AutofillService.doAutoFill), so fill rules, never-fill fields, visible
// fields only, the one-time code rules, and what people who can't see
// passwords may fill all apply as they do to the popup's Fill. This file
// decides when and where that one fill may happen:
//
// - Only the tab the background itself just opened for it (an extension page
//   asks; nothing else can), only for that login, only once, and only within
//   OPEN_AND_FILL_WINDOW_MS. Closing the tab, reloading it, locking, or
//   switching accounts drops it.
// - Only a page whose scheme, host, and port are the address it opened, or
//   that is another of the login's websites by the person's match settings
//   (as upstream's autofill decides it) over https. A top-level navigation to
//   anything else drops it for good, so a redirect to an identity provider or
//   a phishing hop gets nothing, and neither does the page it sends back to.
// - Every frame that gets a value passes the same check on its own address.
// - Never a tab in the background, never a submit, and never a new-password
//   field: the person chose a login, not a sign-up or change-password form.

import { firstValueFrom, last, takeUntil, timer } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import {
  UriMatchStrategy,
  UriMatchStrategySetting,
} from "@bitwarden/common/models/domain/domain-service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { openAndFillUrl } from "@bitwarden/common/vault/keykeeper/open-and-fill";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { fromExtensionPage } from "../../keykeeper/extension-sender";
import { BrowserApi } from "../../platform/browser/browser-api";
import { AutofillService, PageDetail } from "../services/abstractions/autofill.service";

export { OPEN_AND_FILL } from "./open-and-fill-message";

/**
 * How long an opened tab waits for its fill. Long enough for a slow page, a
 * redirect within the site, a form a script draws late, or a click on the
 * site's own "Sign in" link; short enough that a tab left alone doesn't fill
 * whatever it shows a minute later.
 */
export const OPEN_AND_FILL_WINDOW_MS = 60_000;

/** How long a fill waits for the page's frames to describe their fields. */
const COLLECT_WAIT_MS = 900;

/** Waits between tries on a page with nothing to fill yet: a form drawn late. */
const RETRY_FIRST_MS = 250;
const RETRY_MOST_MS = 3_000;

/** One tab's fill, waiting for its page. */
export type OpenAndFillArming = {
  tabId: number;
  cipherId: string;
  userId: UserId;
  /** The scheme, host, and port of the address the tab was opened at. */
  origin: string;
  expiresAt: number;
  /** The last address committed in the tab's top frame, to tell a reload when the browser doesn't. */
  lastUrl: string | null;
};

/** What a request from an extension page says. */
export type OpenAndFillRequest = {
  cipherId: string;
  url: string;
  /** The page asked for the master password already, for an item that asks for it. */
  repromptPassed: boolean;
};

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

/**
 * Whether a page, or a frame in it, is the site the tab was opened for: the
 * same scheme, host, and port as the address it opened, or another of the
 * login's websites by the person's match settings (`itemMatches`, as
 * upstream's autofill decides it), over https only. An http copy of an https
 * site is neither.
 */
export function isOpenedSite(
  arming: Pick<OpenAndFillArming, "origin">,
  url: string,
  itemMatches: boolean,
): boolean {
  const origin = originOf(url);
  if (origin == null) {
    return false;
  }
  return origin === arming.origin || (itemMatches && origin.startsWith("https://"));
}

/**
 * The tabs waiting for their one fill, and the rules for how each one ends.
 * Nothing here touches the browser, so the rules are tested on their own
 * (open-and-fill.spec.ts).
 */
export class OpenAndFillArmings {
  private readonly armings = new Map<number, OpenAndFillArming>();

  /** Arms a tab the extension just opened. A tab holds one fill; a newer one replaces it. */
  arm(tabId: number, cipherId: string, userId: UserId, url: string, now: number) {
    const origin = originOf(url);
    if (origin == null) {
      return null;
    }
    const arming: OpenAndFillArming = {
      tabId,
      cipherId,
      userId,
      origin,
      expiresAt: now + OPEN_AND_FILL_WINDOW_MS,
      lastUrl: null,
    };
    this.armings.set(tabId, arming);
    return arming;
  }

  /** The tab's fill, if it has one that hasn't run out. One that has is dropped. */
  get(tabId: number, now: number): OpenAndFillArming | undefined {
    const arming = this.armings.get(tabId);
    if (arming != null && now >= arming.expiresAt) {
      this.armings.delete(tabId);
      return undefined;
    }
    return arming;
  }

  /** Takes the tab's fill for good: it filled, or something ended it. */
  disarm(tabId: number) {
    this.armings.delete(tabId);
  }

  disarmAll() {
    this.armings.clear();
  }

  /** Drops every fill but the given account's. */
  keepOnly(userId: UserId | null | undefined) {
    for (const [tabId, arming] of this.armings) {
      if (arming.userId !== userId) {
        this.armings.delete(tabId);
      }
    }
  }

  /**
   * A new document in the tab's top frame. A reload ends the fill, and so does
   * any page that isn't the opened site, even if a later one is: a redirect
   * through another site (an identity provider, a phishing hop) never gets it,
   * nor does the page it sends back to. `reload` is the browser's word for it
   * when it has one; without it, the same address committing again counts.
   */
  committed(
    tabId: number,
    url: string,
    reload: boolean | undefined,
    itemMatches: boolean,
    now: number,
  ): void {
    const arming = this.get(tabId, now);
    if (arming == null) {
      return;
    }
    // The empty page a new tab starts with isn't a site; nothing fills it.
    if (url === "about:blank") {
      return;
    }
    const isReload = reload ?? (arming.lastUrl != null && arming.lastUrl === url);
    if (isReload || !isOpenedSite(arming, url, itemMatches)) {
      this.armings.delete(tabId);
      return;
    }
    arming.lastUrl = url;
  }

  armedTabs(): number[] {
    return [...this.armings.keys()];
  }
}

export type OpenAndFillDependencies = {
  autofillService: AutofillService;
  cipherService: CipherService;
  accountService: AccountService;
  authService: AuthService;
  /** Whether the item asks for the master password (and the account has one to ask for). */
  passwordRepromptRequired: (cipher: CipherView) => Promise<boolean>;
  /** Whether the item is for a page by its websites and the person's match settings, as upstream's autofill decides it. */
  itemMatches: (cipher: CipherView, url: string) => Promise<boolean>;
  /** The person's default match setting, for a website that has none of its own. */
  defaultMatch: () => Promise<UriMatchStrategySetting>;
  /** Whether the page is on the person's list of sites autofill stays out of. */
  isBlocked: (url: string) => Promise<boolean>;
  copyToClipboard: (text: string) => void;
  logError: (error: unknown) => void;
  now?: () => number;
};

/** Reads a request, or null when it isn't one. */
export function readOpenAndFillRequest(message: unknown): OpenAndFillRequest | null {
  const m = message as Partial<OpenAndFillRequest> | null;
  if (m == null || typeof m.cipherId !== "string" || typeof m.url !== "string") {
    return null;
  }
  return { cipherId: m.cipherId, url: m.url, repromptPassed: m.repromptPassed === true };
}

/** The background's half: opens the tab, watches it, and fills it once. */
export class KeykeeperOpenAndFill {
  readonly armings = new OpenAndFillArmings();
  private readonly running = new Map<number, { again: boolean }>();
  private readonly retries = new Map<number, ReturnType<typeof setTimeout>>();
  /** The last wait between tries, by tab, so a page with nothing to fill is asked less often. */
  private readonly waits = new Map<number, number>();
  private readonly now: () => number;

  constructor(private readonly deps: OpenAndFillDependencies) {
    this.now = deps.now ?? (() => Date.now());
  }

  init() {
    BrowserApi.addListener(chrome.tabs.onRemoved, (tabId: number) => this.disarm(tabId));
    BrowserApi.addListener(
      chrome.tabs.onUpdated,
      (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
        if (changeInfo.status === "complete" || changeInfo.url != null) {
          this.trigger(tabId);
        }
      },
    );
    BrowserApi.addListener(chrome.tabs.onActivated, ({ tabId }: chrome.tabs.OnActivatedInfo) =>
      this.trigger(tabId),
    );
    if (chrome.webNavigation?.onCommitted != null) {
      BrowserApi.addListener(
        chrome.webNavigation.onCommitted,
        (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
          if (details.frameId === 0) {
            void this.onCommitted(details.tabId, details.url, details.transitionType);
          }
        },
      );
    }
    // Locking, signing out, or switching accounts ends every waiting fill.
    this.deps.authService.activeAccountStatus$.subscribe((status) => {
      if (status !== AuthenticationStatus.Unlocked) {
        this.disarmAll();
      }
    });
    this.deps.accountService.activeAccount$.subscribe((account) =>
      this.armings.keepOnly(account?.id),
    );
  }

  /** Whether a tab still waits for its fill. For tests. */
  isArmed(tabId: number): boolean {
    return this.armings.get(tabId, this.now()) != null;
  }

  /**
   * An extension page's request: opens the login's website in a new tab and
   * arms that tab. Answers whether it opened one. The website must be one of
   * the item's own, and an item that asks for the master password must have
   * asked already.
   */
  async open(message: unknown, sender: chrome.runtime.MessageSender): Promise<boolean> {
    const request = readOpenAndFillRequest(message);
    if (request == null || !fromExtensionPage(sender)) {
      return false;
    }
    const userId = await this.activeUnlockedUser();
    if (userId == null) {
      return false;
    }
    const cipher = await this.cipherFor(userId, request.cipherId);
    if (cipher == null) {
      return false;
    }
    if (!request.repromptPassed && (await this.deps.passwordRepromptRequired(cipher))) {
      return false;
    }
    const website = (cipher.login?.uris ?? []).find((uri) => openAndFillUrl(uri) === request.url);
    if (website == null) {
      return false;
    }
    const tab = await BrowserApi.createNewTab(request.url, true);
    if (tab?.id == null) {
      return false;
    }
    // A website that never fills, by the person's default, only opens.
    if ((website.match ?? (await this.deps.defaultMatch())) === UriMatchStrategy.Never) {
      return true;
    }
    if (this.armings.arm(tab.id, cipher.id, userId, request.url, this.now()) == null) {
      return false;
    }
    // The page may load before any event about it reaches us, so try soon either way.
    this.scheduleRetry(tab.id, RETRY_FIRST_MS);
    return true;
  }

  private disarm(tabId: number) {
    this.armings.disarm(tabId);
    this.clearRetry(tabId);
    this.waits.delete(tabId);
  }

  private disarmAll() {
    for (const tabId of this.armings.armedTabs()) {
      this.clearRetry(tabId);
      this.waits.delete(tabId);
    }
    this.armings.disarmAll();
  }

  private async onCommitted(tabId: number, url: string, transitionType: string | undefined) {
    const arming = this.armings.get(tabId, this.now());
    if (arming == null) {
      return;
    }
    const cipher = await this.cipherFor(arming.userId, arming.cipherId);
    const itemMatches = cipher != null && (await this.deps.itemMatches(cipher, url));
    const reload = transitionType == null ? undefined : transitionType === "reload";
    this.armings.committed(tabId, url, reload, itemMatches, this.now());
    if (this.armings.get(tabId, this.now()) == null) {
      this.disarm(tabId);
    }
  }

  /** Starts a try now, or right after the one running. */
  private trigger(tabId: number) {
    if (this.armings.get(tabId, this.now()) == null) {
      return;
    }
    const running = this.running.get(tabId);
    if (running != null) {
      running.again = true;
      return;
    }
    const state = { again: false };
    this.running.set(tabId, state);
    void (async () => {
      try {
        do {
          state.again = false;
          await this.attempt(tabId);
        } while (state.again && this.armings.get(tabId, this.now()) != null);
      } catch (error) {
        this.deps.logError(error);
      } finally {
        this.running.delete(tabId);
      }
    })();
  }

  private scheduleRetry(tabId: number, wait: number) {
    this.clearRetry(tabId);
    const arming = this.armings.get(tabId, this.now());
    if (arming == null) {
      return;
    }
    this.waits.set(tabId, wait);
    const timerId = setTimeout(
      () => {
        this.retries.delete(tabId);
        this.trigger(tabId);
      },
      Math.max(0, Math.min(wait, arming.expiresAt - this.now())),
    );
    this.retries.set(tabId, timerId);
  }

  private clearRetry(tabId: number) {
    const timerId = this.retries.get(tabId);
    if (timerId != null) {
      clearTimeout(timerId);
      this.retries.delete(tabId);
    }
  }

  /** Tries again later: the page has nothing to fill yet, or isn't in front. */
  private later(tabId: number) {
    const previous = this.waits.get(tabId) ?? RETRY_FIRST_MS / 2;
    this.scheduleRetry(tabId, Math.min(previous * 2, RETRY_MOST_MS));
  }

  /** One try at the tab's fill. */
  private async attempt(tabId: number): Promise<void> {
    const arming = this.armings.get(tabId, this.now());
    if (arming == null) {
      return this.disarm(tabId);
    }
    // The person who opened it, still unlocked.
    if ((await this.activeUnlockedUser()) !== arming.userId) {
      return this.disarm(tabId);
    }
    const tab = await this.liveTab(tabId);
    if (tab?.id == null) {
      return this.disarm(tabId);
    }
    // Only the tab in front: switching back to it tries again.
    if (!tab.active) {
      return this.later(tabId);
    }
    const url = tab.url ?? "";
    if (originOf(url) == null) {
      // Still loading, or the empty page a new tab starts with.
      return this.later(tabId);
    }
    const cipher = await this.cipherFor(arming.userId, arming.cipherId);
    if (cipher == null) {
      return this.disarm(tabId);
    }
    // A page that isn't the opened site, even one whose arrival we missed, ends it.
    if (!isOpenedSite(arming, url, await this.deps.itemMatches(cipher, url))) {
      return this.disarm(tabId);
    }
    if (await this.deps.isBlocked(url)) {
      return this.disarm(tabId);
    }

    const pageDetails = await this.pageDetailsFor(tab, arming, cipher);
    // The page may have moved on while its fields were collected.
    const now = await this.liveTab(tabId);
    if (now?.url !== tab.url || this.armings.get(tabId, this.now()) !== arming) {
      return this.later(tabId);
    }
    if (pageDetails.length === 0) {
      return this.later(tabId);
    }

    const result = await this.deps.autofillService.doAutoFill({
      tab,
      cipher,
      pageDetails,
      // As the popup's Fill does, except as noted. A page still loading may
      // not have its password field yet, so only a finished one gets a
      // username alone (the first step of a two-step sign-in).
      skipUsernameOnlyFill: tab.status !== "complete",
      onlyEmptyFields: false,
      allowTotpAutofill: true,
      // Never a new-password field: nobody chose a sign-up or change-password form.
      fillNewPassword: false,
      // A frame the item isn't for gets nothing, without a question in the page.
      allowUntrustedIframe: false,
      autoSubmitLogin: false,
    });
    if (!result.didAutofill) {
      return this.later(tabId);
    }
    // Once: it's spent, whatever the tab does next.
    this.disarm(tabId);
    if (result.totp != null) {
      this.deps.copyToClipboard(result.totp);
    }
  }

  /**
   * The fields of the tab's frames (all of them that answer in time), keeping
   * only frames whose own address is the opened site.
   */
  private async pageDetailsFor(
    tab: chrome.tabs.Tab,
    arming: OpenAndFillArming,
    cipher: CipherView,
  ): Promise<PageDetail[]> {
    const collected = await firstValueFrom(
      this.deps.autofillService
        .collectPageDetailsFromTab$(tab)
        .pipe(takeUntil(timer(COLLECT_WAIT_MS)), last(undefined, [] as PageDetail[])),
    );
    const kept: PageDetail[] = [];
    for (const detail of collected) {
      const frameUrl = detail.details?.url ?? "";
      if (
        detail.details?.fields?.length &&
        isOpenedSite(arming, frameUrl, await this.deps.itemMatches(cipher, frameUrl))
      ) {
        kept.push(detail);
      }
    }
    return kept;
  }

  private async liveTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
    return (await BrowserApi.getTab(tabId)?.catch((): undefined => undefined)) ?? undefined;
  }

  private async activeUnlockedUser(): Promise<UserId | null> {
    const userId = await firstValueFrom(
      this.deps.accountService.activeAccount$.pipe(getOptionalUserId),
    );
    if (userId == null) {
      return null;
    }
    const status = await this.deps.authService.getAuthStatus(userId);
    return status === AuthenticationStatus.Unlocked ? userId : null;
  }

  /** The login, as it is now: edits and changed permissions count. */
  private async cipherFor(userId: UserId, cipherId: string): Promise<CipherView | null> {
    const cipher = (await this.deps.cipherService.getAllDecrypted(userId)).find(
      (c) => c.id === cipherId,
    );
    if (cipher == null || cipher.type !== CipherType.Login || cipher.isDeleted) {
      return null;
    }
    return cipher;
  }
}
