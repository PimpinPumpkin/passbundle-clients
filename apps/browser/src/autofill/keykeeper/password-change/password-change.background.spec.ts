import { BehaviorSubject } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherRepromptType, CipherType } from "@bitwarden/common/vault/enums";
import {
  editableCopy,
  PASSWORD_CHANGE_FIELD_NAME,
  readPasswordChangeMarker,
  unfinishedPasswordChange,
} from "@bitwarden/common/vault/keykeeper/password-change";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";

import { BrowserApi } from "../../../platform/browser/browser-api";

import {
  FillAnswer,
  PAGE_FILL,
  PAGE_NOTE,
  PAGE_READ,
  PAGE_STEP,
  PAGE_WATCH,
  PageReading,
} from "./password-change-messages";
import { FIND_FORM_MS, KeykeeperPasswordChange, RESULT_MS } from "./password-change.background";

const userId = "user-1" as UserId;
const cipherId = "1b9b2c1e-0000-4000-8000-000000000001";
const site = "https://accounts.example.test";
const wellKnown = `${site}/.well-known/change-password`;
const formPage = `${site}/settings/password`;
const OLD = "old-password-1";

function accountItem(): CipherView {
  const cipher = new CipherView();
  cipher.id = cipherId;
  cipher.name = "Accounts";
  cipher.type = CipherType.Login;
  cipher.reprompt = CipherRepromptType.None;
  cipher.edit = true;
  cipher.viewPassword = true;
  cipher.login = new LoginView();
  cipher.login.username = "alice";
  cipher.login.password = OLD;
  const website = new LoginUriView();
  website.uri = `${site}/login`;
  cipher.login.uris = [website];
  return cipher;
}

/** What a page with a standard change-password form reads as. */
function formReading(more: Partial<PageReading> = {}): PageReading {
  return {
    url: formPage,
    form: "form",
    codeField: false,
    captcha: false,
    confirmMessage: false,
    changedMessage: false,
    errorMessage: false,
    invalidField: false,
    recipeChanged: false,
    recipeRefused: false,
    rules: [],
    submitButton: true,
    stepReady: false,
    filledHere: false,
    ...more,
  };
}

describe("Keykeeper assisted password change: the background", () => {
  const popup = {} as chrome.runtime.MessageSender;

  let item: CipherView;
  let now: number;
  let status$: BehaviorSubject<AuthenticationStatus>;
  let activeAccount$: BehaviorSubject<{ id: UserId } | null>;
  let tabs: Map<number, chrome.tabs.Tab>;
  let injected: boolean;
  /** Every request the page got, in order, with the saves among them. */
  let log: string[];
  let read: jest.Mock<PageReading | undefined, []>;
  let fill: jest.Mock<FillAnswer | undefined, [object]>;
  let watch: jest.Mock<PageReading | undefined, []>;
  let save: jest.Mock;
  let send: jest.Mock;
  let generated: string;
  let changePage: string | null;
  let service: KeykeeperPasswordChange;

  const listener = (event: { addListener: unknown }) =>
    (event.addListener as jest.Mock).mock.calls.at(-1)[0];

  /** A top-frame page arriving in the tab, as the browser reports it. */
  async function load(url: string, tabId = 7) {
    const tab = tabs.get(tabId)!;
    tab.url = url;
    tab.status = "complete";
    injected = false;
    listener(chrome.webNavigation.onCommitted)({ tabId, frameId: 0, url, transitionType: "link" });
    listener(chrome.tabs.onUpdated)(tabId, { status: "complete" }, tab);
    await jest.advanceTimersByTimeAsync(0);
  }

  async function start(message: object = { cipherId, repromptPassed: false }, sender = popup) {
    const answer = await service.start(message, sender);
    await jest.advanceTimersByTimeAsync(0);
    return answer;
  }

  /** Runs the clock, the change's ticks with it. */
  const wait = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  const marker = () => unfinishedPasswordChange(item);
  const pageGot = (command: string) => send.mock.calls.filter(([, m]) => m.command === command);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    item = accountItem();
    now = new Date("2026-11-08T10:00:00.000Z").getTime();
    jest.setSystemTime(now);
    status$ = new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked);
    activeAccount$ = new BehaviorSubject<{ id: UserId } | null>({ id: userId });
    tabs = new Map();
    injected = false;
    log = [];
    generated = "Generated-password-20!";
    changePage = null;
    read = jest.fn((): PageReading | undefined => formReading());
    fill = jest.fn((_message: object): FillAnswer | undefined => ({
      url: formPage,
      filled: true,
      invalid: false,
      restInvalid: false,
      submitted: true,
    }));
    watch = jest.fn((): PageReading | undefined =>
      formReading({ changedMessage: true, filledHere: true }),
    );
    // Saves as upstream's does: a changed password goes to history, with its revision date.
    save = jest.fn(async (draft: CipherView) => {
      log.push("save");
      const saved = editableCopy(draft);
      if (saved.login.password !== item.login.password) {
        const entry = new PasswordHistoryView();
        entry.password = item.login.password;
        entry.lastUsedDate = saved.login.passwordRevisionDate = new Date(Date.now());
        saved.passwordHistory = [entry, ...(item.passwordHistory ?? [])];
      }
      item = saved;
      return saved;
    });
    send = jest.fn(async (_tabId: number, message: { command: string }) => {
      if (!injected) {
        return undefined;
      }
      log.push(message.command);
      switch (message.command) {
        case PAGE_READ:
          return read();
        case PAGE_FILL:
          return fill(message);
        case PAGE_WATCH:
          return watch();
        case PAGE_STEP:
          return { clicked: true };
        case PAGE_NOTE:
          return { shown: true };
      }
    });

    jest.spyOn(BrowserApi, "createNewTab").mockImplementation(async (url: string) => {
      const tab = { id: 7, url, active: true, status: "loading" } as chrome.tabs.Tab;
      tabs.set(7, tab);
      return tab;
    });
    jest.spyOn(BrowserApi, "getTab").mockImplementation(async (tabId: number) => {
      const tab = tabs.get(tabId);
      if (tab == null) {
        throw new Error("No tab with id");
      }
      return { ...tab };
    });

    service = new KeykeeperPasswordChange({
      cipherService: {
        getAllDecrypted: jest.fn(async () => [item]),
        updateWithServer: save,
      } as unknown as CipherService,
      accountService: { activeAccount$ } as unknown as AccountService,
      authService: {
        activeAccountStatus$: status$,
        getAuthStatus: jest.fn(async () => status$.value),
      } as unknown as AuthService,
      passwordRepromptRequired: async (cipher) => cipher.reprompt === CipherRepromptType.Password,
      itemMatches: async (cipher, url) =>
        cipher.login.matchesUri(url, new Set<string>(), UriMatchStrategy.Domain),
      defaultMatch: async () => UriMatchStrategy.Domain,
      isBlocked: async () => false,
      generatePassword: async () => generated,
      inject: jest.fn(async () => {
        injected = true;
      }),
      send,
      t: (key, ...subs) => [key, ...subs].join(" "),
      changePageFor: () => changePage,
      recipeFor: () => null,
      logError: jest.fn(),
    });
    service.init();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("starting", () => {
    it("starts only for one of the extension's own pages", async () => {
      const contentScript = {
        tab: { id: 3 },
        frameId: 0,
        url: site,
      } as chrome.runtime.MessageSender;
      expect(await start(undefined, contentScript)).toEqual({
        started: false,
        reason: "notAllowed",
      });
      expect(BrowserApi.createNewTab).not.toHaveBeenCalled();
      expect(await start({ cipherId: 42 })).toEqual({ started: false, reason: "notAllowed" });
    });

    it("starts only for a login the person can edit and see the password of", async () => {
      item.edit = false;
      expect(await start()).toEqual({ started: false, reason: "notAllowed" });
      item = accountItem();
      item.viewPassword = false;
      expect(await start()).toEqual({ started: false, reason: "notAllowed" });
      item = accountItem();
      item.organizationId = "org-1";
      expect(await start()).toEqual({ started: false, reason: "notAllowed" });
      expect(BrowserApi.createNewTab).not.toHaveBeenCalled();
    });

    it("needs the master password asked for an item that asks for it", async () => {
      item.reprompt = CipherRepromptType.Password;
      expect(await start()).toEqual({ started: false, reason: "reprompt" });
      expect(await start({ cipherId, repromptPassed: true })).toEqual({ started: true });
    });

    it("isn't for a locked account", async () => {
      status$.next(AuthenticationStatus.Locked);
      expect(await start()).toEqual({ started: false, reason: "locked" });
    });

    it("runs one at a time", async () => {
      expect(await start()).toEqual({ started: true });
      expect(await start()).toEqual({ started: false, reason: "running" });
    });

    it("opens the site's well-known change-password address in a new tab", async () => {
      await start();
      expect(BrowserApi.createNewTab).toHaveBeenCalledWith(wellKnown, true);
      expect(service.isRunning(7)).toBe(true);
    });

    it("opens the published change-password page only when it's the item's own site", async () => {
      changePage = "https://www.example.test/account/password";
      await start();
      expect(BrowserApi.createNewTab).toHaveBeenLastCalledWith(changePage, true);
    });

    it("doesn't open a published page on another domain, and goes to the well-known address", async () => {
      changePage = "https://my.hosting.test/profile/security";
      await start();
      expect(BrowserApi.createNewTab).toHaveBeenLastCalledWith(wellKnown, true);
    });
  });

  describe("changing", () => {
    it("saves the new password before anything is filled, then fills, presses, and sees it changed", async () => {
      await start();
      await load(formPage);
      await wait(1_000);

      // Saved first: the save comes before any fill.
      expect(log.indexOf("save")).toBeGreaterThan(-1);
      expect(log.indexOf("save")).toBeLessThan(log.indexOf(PAGE_FILL));
      expect(fill).toHaveBeenCalledWith(
        expect.objectContaining({ current: OLD, next: generated, submit: true }),
      );
      // The site said it changed: the marker is off, the new password stays, the old is in history.
      expect(item.login.password).toBe(generated);
      expect(item.passwordHistory[0].password).toBe(OLD);
      expect(readPasswordChangeMarker(item)).toBeNull();
      expect(save).toHaveBeenCalledTimes(2);
      expect(service.status(cipherId)).toMatchObject({ running: false, result: "changed" });
      expect(service.isRunning(7)).toBe(false);
    });

    it("saves the marker with the new password, pending, before the fill", async () => {
      fill.mockImplementation(() => {
        // At the fill, the item already has the new password and says it's unfinished.
        expect(item.login.password).toBe(generated);
        expect(marker()?.state).toBe("pending");
        expect(item.fields.find((f) => f.name === PASSWORD_CHANGE_FIELD_NAME)).toBeTruthy();
        return { url: formPage, filled: true, invalid: false, restInvalid: false, submitted: true };
      });
      await start();
      await load(formPage);
      await wait(1_000);
      expect(fill).toHaveBeenCalled();
    });

    it("fills nothing when the save fails, and says nothing changed", async () => {
      save.mockRejectedValueOnce(new Error("offline"));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(pageGot(PAGE_FILL)).toHaveLength(0);
      expect(item.login.password).toBe(OLD);
      expect(service.status(cipherId)).toMatchObject({
        note: "stopped.saveFailed",
        running: false,
      });
    });

    it("stops when the item's password changed since the start", async () => {
      await start();
      item.login.password = "changed-by-hand";
      await load(formPage);
      await wait(1_000);
      expect(save).not.toHaveBeenCalled();
      expect(pageGot(PAGE_FILL)).toHaveLength(0);
      expect(service.status(cipherId)?.note).toBe("stopped.changedMeanwhile");
    });

    it("makes the new password to the form's own rules", async () => {
      generated = "Abcdefghijklmnopqrstuvwxyz-0123456789!";
      read.mockReturnValue(formReading({ rules: [{ maxLength: 16, minLength: 12 }] }));
      await start();
      await load(formPage);
      await wait(1_000);
      const next = (fill.mock.calls[0][0] as { next: string }).next;
      expect(next.length).toBeGreaterThanOrEqual(12);
      expect(next.length).toBeLessThanOrEqual(16);
      expect(item.login.password).toBe(next);
    });

    it("stops before saving when no password fits the rules", async () => {
      read.mockReturnValue(formReading({ rules: [{ maxLength: 6 }, { minLength: 10 }] }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(save).not.toHaveBeenCalled();
      expect(service.status(cipherId)?.note).toBe("stopped.rules");
    });
  });

  describe("only its own tab, in front, on the item's site", () => {
    it("doesn't read the page while the tab isn't in front, and goes on when it is", async () => {
      await start();
      tabs.get(7)!.active = false;
      await load(formPage);
      await wait(3_000);
      expect(pageGot(PAGE_READ)).toHaveLength(0);
      tabs.get(7)!.active = true;
      listener(chrome.tabs.onActivated)({ tabId: 7, windowId: 1 });
      await wait(1_000);
      expect(pageGot(PAGE_FILL)).toHaveLength(1);
    });

    it("ignores every other tab", async () => {
      await start();
      tabs.set(8, { id: 8, url: formPage, active: true, status: "complete" } as chrome.tabs.Tab);
      listener(chrome.tabs.onUpdated)(8, { status: "complete" }, tabs.get(8));
      await wait(0);
      expect(send.mock.calls.every(([tabId]) => tabId === 7)).toBe(true);
    });

    it("stops for good when the tab goes to another site before the save, and tells that site nothing", async () => {
      await start();
      await load("https://login.elsewhere.test/cp/form");
      await wait(2_000);
      expect(service.isRunning(7)).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(service.status(cipherId)?.note).toBe("stopped.elsewhere");
      // Coming back to the site gets nothing either.
      await load(formPage);
      await wait(2_000);
      expect(send).not.toHaveBeenCalled();
    });

    it("never works on an http copy of the site", async () => {
      await start();
      await load("http://accounts.example.test/settings/password");
      await wait(1_000);
      expect(service.isRunning(7)).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it("leaves the item asking when the tab goes elsewhere after the save", async () => {
      watch.mockImplementation(() => undefined);
      fill.mockImplementation(() => undefined);
      await start();
      await load(formPage);
      await wait(1_000);
      await load("https://sso.elsewhere.test/");
      await wait(1_000);
      expect(item.login.password).toBe(generated);
      expect(marker()?.state).toBe("unsure");
      expect(service.isRunning(7)).toBe(false);
    });

    it("stops when the tab closes", async () => {
      await start();
      listener(chrome.tabs.onRemoved)(7);
      await wait(0);
      expect(service.isRunning(7)).toBe(false);
    });

    it("stops when the vault locks; after the save, the item is left asking", async () => {
      fill.mockReturnValue({
        url: formPage,
        filled: true,
        invalid: false,
        restInvalid: false,
        submitted: true,
      });
      watch.mockImplementation(() => formReading({ filledHere: true }));
      await start();
      await load(formPage);
      await wait(1_000);
      status$.next(AuthenticationStatus.Locked);
      await wait(0);
      expect(service.isRunning(7)).toBe(false);
      expect(marker()?.state).toBe("pending");
    });
  });

  describe("results", () => {
    it("leaves the marker saying refused when the form comes back with an error", async () => {
      watch.mockReturnValue(formReading({ errorMessage: true, filledHere: true }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(marker()?.state).toBe("refused");
      expect(item.login.password).toBe(generated);
      expect(service.status(cipherId)?.result).toBe("refused");
    });

    it("says refused without pressing when the fill didn't take or the form turned it down", async () => {
      fill.mockReturnValue({
        url: formPage,
        filled: true,
        invalid: true,
        restInvalid: false,
        submitted: false,
      });
      await start();
      await load(formPage);
      await wait(1_000);
      expect(pageGot(PAGE_WATCH)).toHaveLength(0);
      expect(marker()?.state).toBe("refused");
    });

    it("asks when the form goes away without a word", async () => {
      watch.mockReturnValue(formReading({ form: "none", filledHere: true }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(marker()?.state).toBe("unsure");
    });

    it("asks when nothing shows within the time", async () => {
      watch.mockReturnValue(formReading({ filledHere: true }));
      await start();
      await load(formPage);
      await wait(RESULT_MS + 2_000);
      expect(marker()?.state).toBe("unsure");
      expect(service.isRunning(7)).toBe(false);
    });

    it("reads the page the press led to", async () => {
      // The press took the page away before the fill's answer came back.
      fill.mockReturnValue(undefined);
      await start();
      await load(formPage);
      await wait(1_000);
      expect(service.isRunning(7)).toBe(true);
      read.mockReturnValue(
        formReading({ url: `${site}/done`, form: "none", changedMessage: true }),
      );
      await load(`${site}/done`);
      await wait(1_000);
      expect(readPasswordChangeMarker(item)).toBeNull();
      expect(service.status(cipherId)?.result).toBe("changed");
    });

    it("asks about a page after the press that says nothing either way", async () => {
      fill.mockReturnValue(undefined);
      await start();
      await load(formPage);
      await wait(1_000);
      read.mockReturnValue(formReading({ url: `${site}/account`, form: "signIn" }));
      await load(`${site}/account`);
      await wait(5_000);
      expect(marker()?.state).toBe("unsure");
    });

    it("never fills a page the press led to", async () => {
      fill.mockReturnValue(undefined);
      await start();
      await load(formPage);
      await wait(1_000);
      read.mockReturnValue(formReading({ errorMessage: true }));
      await load(formPage);
      await wait(1_000);
      expect(pageGot(PAGE_FILL)).toHaveLength(1);
      expect(marker()?.state).toBe("refused");
    });
  });

  describe("handing over", () => {
    it("fills without pressing for a CAPTCHA, saved first, and finishes when the person does", async () => {
      read.mockReturnValue(formReading({ captcha: true }));
      fill.mockReturnValue({
        url: formPage,
        filled: true,
        invalid: false,
        restInvalid: false,
        submitted: false,
      });
      watch.mockReturnValue(formReading({ filledHere: true, captcha: false }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(fill).toHaveBeenCalledWith(expect.objectContaining({ submit: false }));
      expect(log.indexOf("save")).toBeLessThan(log.indexOf(PAGE_FILL));
      expect(service.status(cipherId)?.note).toBe("handoverCaptcha");
      // Still watching long after the usual 30 seconds.
      await wait(RESULT_MS * 2);
      expect(service.isRunning(7)).toBe(true);

      watch.mockReturnValue(formReading({ filledHere: true, changedMessage: true }));
      await wait(30_000);
      expect(readPasswordChangeMarker(item)).toBeNull();
      expect(service.status(cipherId)?.result).toBe("changed");
    });

    it("hands over for a code the site asks for after the press", async () => {
      watch.mockReturnValueOnce(formReading({ filledHere: true, codeField: true }));
      watch.mockReturnValue(formReading({ filledHere: true }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(service.status(cipherId)?.note).toBe("handoverCode");
      expect(service.isRunning(7)).toBe(true);
      expect(marker()?.state).toBe("pending");
    });

    it("hands over a form whose button it can't be sure of", async () => {
      read.mockReturnValue(formReading({ submitButton: false }));
      fill.mockReturnValue({
        url: formPage,
        filled: true,
        invalid: false,
        restInvalid: false,
        submitted: false,
      });
      watch.mockReturnValue(formReading({ filledHere: true }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(fill).toHaveBeenCalledWith(expect.objectContaining({ submit: false }));
      expect(service.status(cipherId)?.note).toBe("handoverButton");
    });

    it("stops, changing nothing, at a form without a current password, or more than one form", async () => {
      read.mockReturnValue(formReading({ form: "noCurrent" }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(save).not.toHaveBeenCalled();
      expect(service.status(cipherId)?.note).toBe("stopped.noCurrent");

      read.mockReturnValue(formReading({ form: "ambiguous" }));
      await start();
      await load(formPage);
      await wait(1_000);
      expect(save).not.toHaveBeenCalled();
      expect(service.status(cipherId)?.note).toBe("stopped.ambiguous");
    });

    it("waits at a sign-in page for the change-password form", async () => {
      read.mockReturnValue(formReading({ form: "signIn" }));
      await start();
      await load(`${site}/login`);
      await wait(1_000);
      expect(service.status(cipherId)?.note).toBe("signIn");
      expect(save).not.toHaveBeenCalled();
      read.mockReturnValue(formReading());
      await load(formPage);
      await wait(1_000);
      expect(save).toHaveBeenCalled();
    });

    it("gives up waiting for a form after its time, changing nothing", async () => {
      read.mockReturnValue(formReading({ form: "none" }));
      await start();
      await load(`${site}/not-found`);
      await wait(15_000);
      expect(service.status(cipherId)?.note).toBe("noForm");
      await wait(FIND_FORM_MS);
      expect(service.isRunning(7)).toBe(false);
      expect(service.status(cipherId)?.note).toBe("stopped.timeout");
      expect(save).not.toHaveBeenCalled();
    });

    it("presses a recipe's step when the page shows it, then looks again", async () => {
      read.mockReturnValueOnce(formReading({ form: "none", stepReady: true }));
      read.mockReturnValue(formReading());
      await start();
      await load(`${site}/settings`);
      await wait(2_000);
      expect(pageGot(PAGE_STEP)).toHaveLength(1);
      expect(pageGot(PAGE_FILL)).toHaveLength(1);
    });
  });
});
