// Keykeeper: assisted password change, the background's half (DESIGN.md,
// "Assisted password change"). Change password on a login, in one of the
// extension's own pages, asks this to change the password on the site:
//
// - Only a request from the extension's own pages starts one, for a login the
//   person can edit and see the password of, and one runs at a time.
// - It opens a new tab at the site's change-password page and works only in
//   that tab, only while it's in front, and only while it shows the item's
//   own site over https. A top-level page anywhere else stops it for good.
// - It saves the new password to the item (the old one goes to password
//   history, and the server keeps the version before) before anything is
//   filled or pressed, with a marker that says the change isn't finished.
// - It fills the site's form and presses its button, or hands the filled
//   form to the person for a CAPTCHA, a code, or a button it can't be sure
//   of, and stops with a plain note for anything it doesn't recognize.
// - It tells changed, refused, and can't tell apart, and leaves the item's
//   marker saying which, so the item asks "Did the new password work?" and
//   puts the old password back with one click.
//
// Every step reads the tab again first. The content script
// (password-change-content.ts) only answers this, at the address it checked.

import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import {
  UriMatchStrategy,
  UriMatchStrategySetting,
} from "@bitwarden/common/models/domain/domain-service";
import { changePasswordUrlFor } from "@bitwarden/common/tools/keykeeper/change-password-urls";
import {
  PasswordChangeRecipe,
  recipeForHost,
  recipeRules,
} from "@bitwarden/common/tools/keykeeper/password-change-recipes";
import {
  passwordForChange,
  rulesForFields,
} from "@bitwarden/common/tools/keykeeper/password-rules";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { openAndFillUrl } from "@bitwarden/common/vault/keykeeper/open-and-fill";
import {
  mayChangePassword,
  organizationAllowsPasswordChange,
  PasswordChangeState,
  withChangeConfirmed,
  withChangeState,
  withNewPassword,
} from "@bitwarden/common/vault/keykeeper/password-change";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { fromExtensionPage } from "../../../keykeeper/extension-sender";
import { BrowserApi } from "../../../platform/browser/browser-api";

import {
  FillAnswer,
  Mismatch,
  PAGE_FILL,
  PAGE_NOTE,
  PAGE_READ,
  PAGE_STEP,
  PAGE_WATCH,
  PageReading,
  StartAnswer,
} from "./password-change-messages";

export { PASSWORD_CHANGE_START, PASSWORD_CHANGE_STATUS } from "./password-change-messages";

/** How long the tab may take to show a change-password form: time to sign in, or to find the page. */
export const FIND_FORM_MS = 5 * 60_000;
/** How long after the press the page has to show a result. */
export const RESULT_MS = 30_000;
/** How long the person has to finish on the page after a hand-over. */
export const HANDOVER_MS = 10 * 60_000;
/** A page still drawing its form gets this long after it loads before it's told there's none. */
const DRAWING_MS = 10_000;
/** A page the site loaded after the press, with nothing on it either way, gets this long to say something. */
const NEXT_PAGE_MS = 3_000;
/** The longest one look at the page takes, so the background keeps checking the tab in between. */
const WATCH_CHUNK_MS = 20_000;
/** How often a running change looks at its tab. */
const TICK_MS = 1_000;
/** How often a page without the form is read again, besides on a load or a return to the front. */
const READ_AGAIN_MS = 2_000;

/** Why a change stopped before its new password was saved. Nothing was changed. */
type StopReason =
  | "closed"
  | "elsewhere"
  | "locked"
  | "gone"
  | "timeout"
  | "noCurrent"
  | "ambiguous"
  | "rules"
  | "changedMeanwhile"
  | "saveFailed";

/** What the note on the page says, by its message's key. */
type NoteKey =
  | "finding"
  | "signIn"
  | "noForm"
  | "captchaFirst"
  | "saving"
  | "submitting"
  | "handoverCaptcha"
  | "handoverCode"
  | "handoverEmail"
  | "handoverForm"
  | "handoverButton"
  | "changed"
  | "refused"
  | "unsure"
  | `stopped.${StopReason}`
  | "elsewhereAfterSave"
  | "lockedAfterSave";

/** Each note's message (brand/messages.en.json). Each gets the site's host as $SITE$. */
const NOTE_MESSAGES: Record<NoteKey, string> = {
  finding: "keykeeperPasswordChangeFinding",
  signIn: "keykeeperPasswordChangeSignIn",
  noForm: "keykeeperPasswordChangeNoForm",
  captchaFirst: "keykeeperPasswordChangeCaptchaFirst",
  saving: "keykeeperPasswordChangeSaving",
  submitting: "keykeeperPasswordChangeSubmitting",
  handoverCaptcha: "keykeeperPasswordChangeHandoverCaptcha",
  handoverCode: "keykeeperPasswordChangeHandoverCode",
  handoverEmail: "keykeeperPasswordChangeHandoverEmail",
  handoverForm: "keykeeperPasswordChangeHandoverForm",
  handoverButton: "keykeeperPasswordChangeHandoverButton",
  changed: "keykeeperPasswordChangeChanged",
  refused: "keykeeperPasswordChangeRefused",
  unsure: "keykeeperPasswordChangeUnsure",
  "stopped.closed": "keykeeperPasswordChangeStoppedClosed",
  "stopped.elsewhere": "keykeeperPasswordChangeStoppedElsewhere",
  "stopped.locked": "keykeeperPasswordChangeStoppedLocked",
  "stopped.gone": "keykeeperPasswordChangeStoppedGone",
  "stopped.timeout": "keykeeperPasswordChangeStoppedTimeout",
  "stopped.noCurrent": "keykeeperPasswordChangeStoppedNoCurrent",
  "stopped.ambiguous": "keykeeperPasswordChangeStoppedAmbiguous",
  "stopped.rules": "keykeeperPasswordChangeStoppedRules",
  "stopped.changedMeanwhile": "keykeeperPasswordChangeStoppedChangedMeanwhile",
  "stopped.saveFailed": "keykeeperPasswordChangeStoppedSaveFailed",
  elsewhereAfterSave: "keykeeperPasswordChangeElsewhereAfterSave",
  lockedAfterSave: "keykeeperPasswordChangeLockedAfterSave",
};

type Phase = "finding" | "busy" | "fill" | "watching" | "handover";

type Run = {
  tabId: number;
  cipherId: string;
  userId: UserId;
  /** The site's host, for the marker and the notes. */
  site: string;
  /** The scheme, host, and port of the address the tab opened at. */
  origin: string;
  /** The password the item had at the start: a different one by the save means someone changed it meanwhile. */
  oldPassword: string;
  recipe: PasswordChangeRecipe | null;
  step: number;
  phase: Phase;
  findUntil: number;
  watchUntil: number;
  /** When the tab's page last finished loading. */
  loadedAt: number | null;
  /** The new password is saved to the item: a stop now leaves "Did it work?". */
  saved: boolean;
  /** The fill waiting for the tab to come back to the front. */
  pendingFill: { url: string; next: string; submit: boolean; handover: NoteKey } | null;
  /** A page came after the one that was filled. */
  navigatedSinceFill: boolean;
  /** The note the page in the tab shows now, so it isn't sent again. */
  shownNote: NoteKey | null;
  /** The new password is being saved: a stop now waits for the save to end. */
  saving: boolean;
  /** A page without the form is read again on a load, a return to the front, or after this. */
  nextReadAt: number;
  stopRequested: StopReason | null;
};

/** The last thing a change said, for the item's card and for tests. */
export type PasswordChangeStatus = {
  cipherId: string;
  tabId: number;
  running: boolean;
  note: NoteKey;
  text: string;
  /** How it ended, once it has. */
  result?: PasswordChangeState | "changed" | "stopped";
};

export type PasswordChangeDependencies = {
  cipherService: Pick<CipherService, "getAllDecrypted" | "updateWithServer">;
  accountService: AccountService;
  authService: AuthService;
  /** Whether the item asks for the master password (and the account has one to ask for). */
  passwordRepromptRequired: (cipher: CipherView) => Promise<boolean>;
  /** Whether the item is for a page by its websites and the person's match settings, as autofill decides it. */
  itemMatches: (cipher: CipherView, url: string) => Promise<boolean>;
  /** The person's default match setting, for a website without one of its own. */
  defaultMatch: () => Promise<UriMatchStrategySetting>;
  /** Whether the page is on the person's list of sites autofill stays out of. */
  isBlocked: (url: string) => Promise<boolean>;
  /** A new password from the generator: the person's settings and the organization's policy. */
  generatePassword: () => Promise<string>;
  /** Puts the content script in the tab's top frame. */
  inject: (tabId: number) => Promise<void>;
  /** Sends the tab's top frame a request; undefined when nothing there answers. */
  send: (tabId: number, message: object) => Promise<unknown>;
  /** The extension's words. */
  t: (key: string, ...substitutions: string[]) => string;
  organizationAllows?: (organizationId: string) => boolean;
  recipeFor?: (host: string) => PasswordChangeRecipe | null;
  changePageFor?: (host: string) => string | null;
  logError: (error: unknown) => void;
  now?: () => number;
};

const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
};

const isMismatch = (answer: unknown): answer is Mismatch =>
  (answer as Mismatch | null)?.mismatch === true;

/** Reads a start request, or null when it isn't one. */
export function readStartRequest(
  message: unknown,
): { cipherId: string; repromptPassed: boolean } | null {
  const m = message as { cipherId?: unknown; repromptPassed?: unknown } | null;
  if (m == null || typeof m.cipherId !== "string" || m.cipherId === "") {
    return null;
  }
  return { cipherId: m.cipherId, repromptPassed: m.repromptPassed === true };
}

export class KeykeeperPasswordChange {
  private run: Run | null = null;
  private last: PasswordChangeStatus | null = null;
  private busy = false;
  private again = false;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly organizationAllows: (organizationId: string) => boolean;
  private readonly recipeFor: (host: string) => PasswordChangeRecipe | null;
  private readonly changePageFor: (host: string) => string | null;

  constructor(private readonly deps: PasswordChangeDependencies) {
    this.now = deps.now ?? (() => Date.now());
    this.organizationAllows = deps.organizationAllows ?? organizationAllowsPasswordChange;
    this.recipeFor = deps.recipeFor ?? ((host) => recipeForHost(host));
    this.changePageFor = deps.changePageFor ?? ((host) => changePasswordUrlFor(host));
  }

  init() {
    BrowserApi.addListener(chrome.tabs.onRemoved, (tabId: number) => {
      if (this.run?.tabId === tabId) {
        void this.stop(this.run, "closed");
      }
    });
    BrowserApi.addListener(
      chrome.tabs.onUpdated,
      (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
        const run = this.run;
        if (run?.tabId !== tabId) {
          return;
        }
        if (changeInfo.status === "loading") {
          run.loadedAt = null;
        }
        if (changeInfo.status === "complete") {
          run.loadedAt = this.now();
          run.nextReadAt = 0;
          this.trigger();
        }
      },
    );
    BrowserApi.addListener(chrome.tabs.onActivated, ({ tabId }: chrome.tabs.OnActivatedInfo) => {
      if (this.run?.tabId === tabId) {
        this.run.nextReadAt = 0;
        this.trigger();
      }
    });
    if (chrome.webNavigation?.onCommitted != null) {
      BrowserApi.addListener(
        chrome.webNavigation.onCommitted,
        (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
          if (details.frameId === 0 && this.run?.tabId === details.tabId) {
            void this.onCommitted(this.run, details.url);
          }
        },
      );
    }
    // Locking, signing out, or switching accounts stops it.
    this.deps.authService.activeAccountStatus$.subscribe((status) => {
      if (this.run != null && status !== AuthenticationStatus.Unlocked) {
        void this.stop(this.run, "locked");
      }
    });
    this.deps.accountService.activeAccount$.subscribe((account) => {
      if (this.run != null && account?.id !== this.run.userId) {
        void this.stop(this.run, "locked");
      }
    });
  }

  /** What the change for an item last said, while it runs and after. For the item's card and tests. */
  status(cipherId?: string): PasswordChangeStatus | null {
    if (cipherId != null && this.last?.cipherId !== cipherId) {
      return null;
    }
    return this.last;
  }

  /** Whether a change is running in this tab. For tests. */
  isRunning(tabId: number): boolean {
    return this.run?.tabId === tabId;
  }

  /**
   * An extension page's request to start a change on an item. Answers whether
   * it started, and why not. Opens the new tab itself, so only that tab is
   * ever worked in.
   */
  async start(message: unknown, sender: chrome.runtime.MessageSender): Promise<StartAnswer> {
    const request = readStartRequest(message);
    if (request == null || !fromExtensionPage(sender)) {
      return { started: false, reason: "notAllowed" };
    }
    if (this.run != null) {
      return { started: false, reason: "running" };
    }
    const userId = await this.activeUnlockedUser();
    if (userId == null) {
      return { started: false, reason: "locked" };
    }
    const cipher = await this.cipherFor(userId, request.cipherId);
    if (cipher == null || !mayChangePassword(cipher, this.organizationAllows)) {
      return { started: false, reason: "notAllowed" };
    }
    if (!request.repromptPassed && (await this.deps.passwordRepromptRequired(cipher))) {
      return { started: false, reason: "reprompt" };
    }
    const start = await this.startPage(cipher);
    if (start == null) {
      return { started: false, reason: "noWebsite" };
    }
    if (this.run != null) {
      return { started: false, reason: "running" };
    }
    const tab = await BrowserApi.createNewTab(start.url, true);
    if (tab?.id == null) {
      return { started: false, reason: "notAllowed" };
    }
    const now = this.now();
    this.run = {
      tabId: tab.id,
      cipherId: cipher.id,
      userId,
      site: hostOf(start.url),
      origin: originOf(start.url)!,
      oldPassword: cipher.login.password,
      recipe: start.recipe,
      step: 0,
      phase: "finding",
      findUntil: now + FIND_FORM_MS,
      watchUntil: 0,
      loadedAt: null,
      saved: false,
      pendingFill: null,
      navigatedSinceFill: false,
      shownNote: null,
      saving: false,
      stopRequested: null,
      nextReadAt: 0,
    };
    this.setStatus(this.run, "finding", true);
    this.ticker ??= setInterval(() => this.trigger(), TICK_MS);
    return { started: true };
  }

  /**
   * The page a change opens, for the first of the item's https websites that
   * fills: a recipe's page, then the site's entry in the published list of
   * change-password pages, used only when that address is the item's own
   * site, then the site's /.well-known/change-password.
   */
  private async startPage(
    cipher: CipherView,
  ): Promise<{ url: string; recipe: PasswordChangeRecipe | null } | null> {
    const defaultMatch = await this.deps.defaultMatch();
    for (const website of cipher.login.uris ?? []) {
      const url = openAndFillUrl(website);
      if (url == null || !url.startsWith("https://")) {
        continue;
      }
      if ((website.match ?? defaultMatch) === UriMatchStrategy.Never) {
        continue;
      }
      const origin = originOf(url)!;
      const host = new URL(url).hostname;
      const recipe = this.recipeFor(host);
      const ownSite = async (page: string | null | undefined) =>
        page != null &&
        page.startsWith("https://") &&
        (originOf(page) === origin || (await this.deps.itemMatches(cipher, page))) &&
        !(await this.deps.isBlocked(page));
      if (await ownSite(recipe?.start)) {
        return { url: recipe!.start!, recipe };
      }
      const listed = this.changePageFor(host);
      if (await ownSite(listed)) {
        return { url: listed!, recipe };
      }
      const wellKnown = `${origin}/.well-known/change-password`;
      if (await ownSite(wellKnown)) {
        return { url: wellKnown, recipe };
      }
    }
    return null;
  }

  /** Whether a page is one the change may work on: the item's own site, over https, not blocked. */
  private async isSite(run: Run, cipher: CipherView, url: string): Promise<boolean> {
    const origin = originOf(url);
    if (origin == null || !origin.startsWith("https://")) {
      return false;
    }
    if (origin !== run.origin && !(await this.deps.itemMatches(cipher, url))) {
      return false;
    }
    return !(await this.deps.isBlocked(url));
  }

  private async onCommitted(run: Run, url: string) {
    if (url === "about:blank") {
      return;
    }
    run.loadedAt = null;
    // A new page: it has no note of ours yet.
    run.shownNote = null;
    if (run.phase === "watching" || run.phase === "handover" || run.phase === "busy") {
      run.navigatedSinceFill = run.saved;
    }
    const cipher = await this.cipherFor(run.userId, run.cipherId);
    if (this.run !== run) {
      return;
    }
    if (cipher == null) {
      return this.stop(run, "gone");
    }
    if (!(await this.isSite(run, cipher, url))) {
      return this.stop(run, "elsewhere");
    }
  }

  /** Starts a look at the tab now, or right after the one running. */
  private trigger() {
    if (this.run == null) {
      return;
    }
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    void (async () => {
      try {
        do {
          this.again = false;
          await this.advance();
        } while (this.again && this.run != null);
      } catch (error) {
        this.deps.logError(error);
      } finally {
        this.busy = false;
      }
    })();
  }

  /** One look at the tab, and the next step if there is one. */
  private async advance(): Promise<void> {
    const run = this.run;
    if (run == null || run.phase === "busy") {
      return;
    }
    const now = this.now();
    if ((await this.activeUnlockedUser()) !== run.userId) {
      return this.stop(run, "locked");
    }
    const tab = await this.liveTab(run.tabId);
    if (tab?.id == null) {
      return this.stop(run, "closed");
    }
    const cipher = await this.cipherFor(run.userId, run.cipherId);
    if (cipher == null) {
      return this.stop(run, "gone");
    }
    const url = tab.url ?? "";
    if (originOf(url) == null) {
      // Still loading, or the empty page a new tab starts with.
      return this.overdue(run, now);
    }
    if (!(await this.isSite(run, cipher, url))) {
      return this.stop(run, "elsewhere");
    }
    if (this.run !== run) {
      return;
    }
    switch (run.phase) {
      case "finding":
        if (now > run.findUntil) {
          return this.stop(run, "timeout");
        }
        // Only the tab in front, and only a page that finished loading.
        if (!tab.active || tab.status !== "complete" || now < run.nextReadAt) {
          return;
        }
        return this.find(run, tab, cipher);
      case "fill":
        if (!tab.active) {
          return this.overdue(run, now);
        }
        return this.fillNow(run, tab);
      case "watching":
      case "handover":
        if (now > run.watchUntil) {
          return this.finish(run, "unsure");
        }
        if (tab.status !== "complete") {
          return;
        }
        return this.watch(run, tab);
    }
  }

  /** A change waiting on the tab past its time stops (before the save) or asks (after). */
  private async overdue(run: Run, now: number) {
    if (run.phase === "finding" && now > run.findUntil) {
      return this.stop(run, "timeout");
    }
    if (run.phase === "fill" && now > run.findUntil) {
      return this.finish(run, "unsure");
    }
    if ((run.phase === "watching" || run.phase === "handover") && now > run.watchUntil) {
      return this.finish(run, "unsure");
    }
  }

  /**
   * Asks the page. A read or a note puts the content script there first if
   * nothing answers. A fill, a step, or a look never does: one that went
   * unanswered may have pressed something, and the page now in the tab is
   * another one, which must never get it a second time.
   */
  private async ask<T>(
    run: Run,
    message: object,
    inject = false,
  ): Promise<T | Mismatch | undefined> {
    let answer = await this.deps.send(run.tabId, message);
    if (answer === undefined && inject && this.run === run) {
      await this.deps.inject(run.tabId);
      answer = await this.deps.send(run.tabId, message);
    }
    return answer as T | Mismatch | undefined;
  }

  private async read(run: Run, tab: chrome.tabs.Tab): Promise<PageReading | null> {
    const answer = await this.ask<PageReading>(
      run,
      { command: PAGE_READ, url: tab.url, recipe: run.recipe, step: run.step },
      true,
    );
    if (answer == null || isMismatch(answer) || this.run !== run) {
      return null;
    }
    return answer;
  }

  /** Looks for the change-password form, and changes the password when it's there. */
  private async find(run: Run, tab: chrome.tabs.Tab, cipher: CipherView) {
    const reading = await this.read(run, tab);
    if (reading == null) {
      return;
    }
    // A page without the form is read again in a moment, sooner when it loads or comes to the front.
    run.nextReadAt = this.now() + READ_AGAIN_MS;
    if (reading.form === "form") {
      return this.change(run, tab, cipher, reading);
    }
    if (reading.stepReady) {
      const answer = await this.ask<{ clicked: boolean }>(run, {
        command: PAGE_STEP,
        url: tab.url,
        recipe: run.recipe,
        step: run.step,
      });
      if (answer != null && !isMismatch(answer) && answer.clicked) {
        run.step++;
      }
      return;
    }
    if (reading.form === "noCurrent") {
      return this.stop(run, "noCurrent");
    }
    if (reading.form === "ambiguous") {
      return this.stop(run, "ambiguous");
    }
    if (reading.captcha) {
      return this.note(run, "captchaFirst");
    }
    if (reading.form === "signIn") {
      return this.note(run, "signIn");
    }
    const drawing = run.loadedAt == null || this.now() - run.loadedAt < DRAWING_MS;
    return this.note(run, drawing ? "finding" : "noForm");
  }

  /**
   * The form is there: makes the new password to every rule, saves it to the
   * item, and only then fills the form (and presses its button, unless it
   * hands over).
   */
  private async change(run: Run, tab: chrome.tabs.Tab, cipher: CipherView, reading: PageReading) {
    run.phase = "busy";
    await this.note(run, "saving");
    let next: string | null;
    try {
      next = passwordForChange(await this.deps.generatePassword(), hostOf(tab.url!), [
        rulesForFields(reading.rules),
        recipeRules(run.recipe),
      ]);
    } catch (error) {
      this.deps.logError(error);
      next = null;
    }
    if (next == null) {
      return this.stop(run, "rules");
    }
    // The item as it is now: still the person's to change, with the password it had at the start.
    const fresh = await this.cipherFor(run.userId, run.cipherId);
    if (
      fresh == null ||
      !mayChangePassword(fresh, this.organizationAllows) ||
      fresh.login.password !== run.oldPassword
    ) {
      return this.stop(run, "changedMeanwhile");
    }
    // The tab, still at that page and in front, right before the save.
    const before = await this.liveTab(run.tabId);
    if (this.run !== run) {
      return;
    }
    if (before?.url !== tab.url || !before.active) {
      run.phase = "finding";
      return;
    }
    run.saving = true;
    try {
      await this.deps.cipherService.updateWithServer(
        withNewPassword(fresh, next, run.site, new Date(this.now())),
        run.userId,
        fresh,
      );
    } catch (error) {
      this.deps.logError(error);
      run.saving = false;
      run.stopRequested = null;
      return this.stop(run, "saveFailed");
    }
    run.saving = false;
    run.saved = true;
    if (run.stopRequested != null) {
      // Stopped while it saved: nothing went to the site, and the item asks.
      return this.stop(run, run.stopRequested);
    }
    const handover: NoteKey | null = reading.captcha
      ? "handoverCaptcha"
      : reading.codeField
        ? "handoverCode"
        : !reading.submitButton
          ? "handoverButton"
          : null;
    run.pendingFill = {
      url: tab.url!,
      next,
      submit: handover == null,
      handover: handover ?? "handoverButton",
    };
    run.phase = "fill";
    if (this.run !== run) {
      return;
    }
    const now = await this.liveTab(run.tabId);
    if (now?.active) {
      return this.fillNow(run, now);
    }
  }

  /** Fills the saved password into the form, in the tab in front, at the address that was read. */
  private async fillNow(run: Run, tab: chrome.tabs.Tab) {
    const fill = run.pendingFill;
    if (fill == null) {
      return;
    }
    if (tab.url !== fill.url) {
      // The page moved on between the save and the fill: nothing was filled.
      return this.finish(run, "unsure");
    }
    run.phase = "busy";
    run.pendingFill = null;
    const answer = await this.ask<FillAnswer>(run, {
      command: PAGE_FILL,
      url: fill.url,
      current: run.oldPassword,
      next: fill.next,
      submit: fill.submit,
      recipe: run.recipe,
    });
    if (this.run !== run) {
      return;
    }
    if (isMismatch(answer)) {
      // The page moved on before the fill: nothing was filled.
      return this.finish(run, "unsure");
    }
    if (answer == null) {
      // No answer: the press likely took the page away as it went. Watch what comes next.
      run.phase = "watching";
      run.navigatedSinceFill = true;
      run.watchUntil = this.now() + RESULT_MS;
      return;
    }
    if (!answer.filled || answer.invalid) {
      // Nothing went to the site: it still has the old password.
      return this.finish(run, "refused");
    }
    run.navigatedSinceFill = false;
    if (answer.submitted) {
      run.phase = "watching";
      run.watchUntil = this.now() + RESULT_MS;
      return this.note(run, "submitting");
    }
    run.phase = "handover";
    run.watchUntil = this.now() + HANDOVER_MS;
    // Handed over on purpose (a CAPTCHA, a code, a button it isn't sure of), or
    // meant to press and something else in the form must be filled first.
    if (!fill.submit) {
      return this.note(run, fill.handover);
    }
    return this.note(run, answer.restInvalid ? "handoverForm" : "handoverButton");
  }

  /** Looks at the page after the press (or while the person finishes) for the result. */
  private async watch(run: Run, tab: chrome.tabs.Tab) {
    const remaining = Math.max(0, run.watchUntil - this.now());
    let reading: PageReading | null;
    if (run.navigatedSinceFill) {
      // The page that came after: what it says as it arrives.
      reading = await this.read(run, tab);
      if (reading != null && !this.decisive(reading) && !reading.codeField) {
        const settled = run.loadedAt != null && this.now() - run.loadedAt >= NEXT_PAGE_MS;
        if (settled && run.phase === "watching") {
          return this.finish(run, "unsure");
        }
        return;
      }
    } else {
      const answer = await this.ask<PageReading>(run, {
        command: PAGE_WATCH,
        url: tab.url,
        ms: Math.min(remaining, WATCH_CHUNK_MS),
        recipe: run.recipe,
      });
      reading = answer == null || isMismatch(answer) ? null : answer;
      if (reading != null && !reading.filledHere) {
        // The content script answering isn't the one that filled: a page came after.
        run.navigatedSinceFill = true;
      }
    }
    if (reading == null || this.run !== run) {
      return;
    }
    return this.judge(run, reading);
  }

  private decisive(r: PageReading): boolean {
    return (
      r.changedMessage ||
      r.recipeChanged ||
      r.recipeRefused ||
      ((r.errorMessage || r.invalidField) && r.form === "form") ||
      r.captcha ||
      r.codeField ||
      r.confirmMessage
    );
  }

  /** What the page says about the change. */
  private async judge(run: Run, r: PageReading) {
    if (r.recipeChanged || r.changedMessage) {
      return this.finish(run, "changed");
    }
    if (r.recipeRefused || ((r.errorMessage || r.invalidField) && r.form === "form")) {
      return this.finish(run, "refused");
    }
    const handover: NoteKey | null = r.captcha
      ? "handoverCaptcha"
      : r.codeField
        ? "handoverCode"
        : r.confirmMessage
          ? "handoverEmail"
          : null;
    if (handover != null) {
      if (run.phase !== "handover") {
        run.phase = "handover";
        run.watchUntil = this.now() + HANDOVER_MS;
      }
      return this.note(run, handover);
    }
    // A same-page look that came back with nothing: the form went away without a word.
    if (run.phase === "watching" && r.form !== "form" && !run.navigatedSinceFill) {
      return this.finish(run, "unsure");
    }
  }

  /**
   * Ends a change whose new password is saved: takes the marker off when the
   * site said it changed, or leaves it saying refused or unsure, so the item
   * asks. If that save fails, the marker still says pending, which asks too.
   */
  private async finish(run: Run, result: PasswordChangeState | "changed") {
    if (this.run !== run) {
      return;
    }
    this.run = null;
    this.stopTicking();
    const key: NoteKey =
      result === "changed" ? "changed" : result === "refused" ? "refused" : "unsure";
    try {
      const fresh = await this.cipherFor(run.userId, run.cipherId);
      const updated =
        fresh == null
          ? null
          : result === "changed"
            ? withChangeConfirmed(fresh)
            : withChangeState(fresh, result === "pending" ? "unsure" : result);
      if (fresh != null && updated != null && (await this.activeUnlockedUser()) === run.userId) {
        await this.deps.cipherService.updateWithServer(updated, run.userId, fresh);
      }
    } catch (error) {
      this.deps.logError(error);
    }
    await this.note(run, key, false, result === "pending" ? "unsure" : result);
  }

  /**
   * Stops a change. Before the save, nothing was changed, and the note says
   * why. After it, the item keeps both passwords and asks.
   */
  private async stop(run: Run, reason: StopReason) {
    if (this.run !== run) {
      return;
    }
    if (run.saving) {
      // The save decides: the change stops right after it.
      run.stopRequested ??= reason;
      return;
    }
    if (run.saved) {
      if (reason === "elsewhere" || reason === "closed" || reason === "locked") {
        this.run = null;
        this.stopTicking();
        // Locked or elsewhere: nothing more can be saved or shown on that page.
        this.setStatus(
          run,
          reason === "locked" ? "lockedAfterSave" : "elsewhereAfterSave",
          false,
          "unsure",
        );
        if (reason !== "locked") {
          await this.saveState(run, "unsure");
        }
        return;
      }
      return this.finish(run, "unsure");
    }
    this.run = null;
    this.stopTicking();
    // A note on another site would tell it something: only the item's own site gets one.
    const quiet = reason === "elsewhere" || reason === "closed";
    await this.note(run, `stopped.${reason}`, false, "stopped", quiet);
  }

  private async saveState(run: Run, state: PasswordChangeState) {
    try {
      const fresh = await this.cipherFor(run.userId, run.cipherId);
      const updated = fresh == null ? null : withChangeState(fresh, state);
      if (fresh != null && updated != null) {
        await this.deps.cipherService.updateWithServer(updated, run.userId, fresh);
      }
    } catch (error) {
      this.deps.logError(error);
    }
  }

  private stopTicking() {
    if (this.ticker != null && this.run == null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private setStatus(
    run: Run,
    note: NoteKey,
    running: boolean,
    result?: PasswordChangeStatus["result"],
  ): string {
    const text = this.deps.t(NOTE_MESSAGES[note], run.site);
    this.last = { cipherId: run.cipherId, tabId: run.tabId, running, note, text, result };
    return text;
  }

  /** Says what's happening on the page, and remembers it for the item's card. */
  private async note(
    run: Run,
    key: NoteKey,
    running = this.run === run,
    result?: PasswordChangeStatus["result"],
    quiet = false,
  ) {
    const text = this.setStatus(run, key, running, result);
    if (quiet || run.shownNote === key) {
      return;
    }
    try {
      const tab = await this.liveTab(run.tabId);
      if (tab?.url == null || originOf(tab.url) == null) {
        return;
      }
      // Only the page that's still the item's own site gets a note.
      const cipher = await this.cipherFor(run.userId, run.cipherId);
      if (cipher == null || !(await this.isSite(run, cipher, tab.url))) {
        return;
      }
      const shown = await this.ask(
        run,
        { command: PAGE_NOTE, title: this.deps.t("keykeeperPasswordChangeNoteTitle"), text },
        true,
      );
      if (shown != null && !isMismatch(shown)) {
        run.shownNote = key;
      }
    } catch (error) {
      this.deps.logError(error);
    }
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
