import { BehaviorSubject, of, Observable } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import {
  UriMatchStrategy,
  UriMatchStrategySetting,
} from "@bitwarden/common/models/domain/domain-service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherRepromptType, CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { BrowserApi } from "../../platform/browser/browser-api";
import AutofillPageDetails from "../models/autofill-page-details";
import { AutofillService, PageDetail } from "../services/abstractions/autofill.service";

import {
  isOpenedSite,
  KeykeeperOpenAndFill,
  OPEN_AND_FILL_WINDOW_MS,
  OpenAndFillArmings,
} from "./open-and-fill";

const userId = "user-1" as UserId;
const cipherId = "1b9b2c1e-0000-4000-8000-000000000001";
const opened = "https://bank.example.test/login";

function bankItem(
  websites: { uri: string; match?: UriMatchStrategySetting }[] = [{ uri: opened }],
): CipherView {
  const cipher = new CipherView();
  cipher.id = cipherId;
  cipher.name = "Example Bank";
  cipher.type = CipherType.Login;
  cipher.reprompt = CipherRepromptType.None;
  cipher.login = new LoginView();
  cipher.login.username = "alice";
  cipher.login.password = "correct-password";
  cipher.login.uris = websites.map(({ uri, match }) => {
    const website = new LoginUriView();
    website.uri = uri;
    website.match = match;
    return website;
  });
  return cipher;
}

describe("Keykeeper Open and fill: the rules", () => {
  describe("isOpenedSite", () => {
    const arming = { origin: "https://bank.example.test" };

    it("is the scheme, host, and port it opened", () => {
      expect(isOpenedSite(arming, "https://bank.example.test/signin?next=1", false)).toBe(true);
      expect(isOpenedSite(arming, "https://bank.example.test:8443/login", false)).toBe(false);
      expect(isOpenedSite(arming, "https://other.example.test/login", false)).toBe(false);
    });

    it("never an http copy of an https site, even one the item matches", () => {
      expect(isOpenedSite(arming, "http://bank.example.test/login", false)).toBe(false);
      expect(isOpenedSite(arming, "http://bank.example.test/login", true)).toBe(false);
    });

    it("or another of the login's websites by the person's match settings, over https", () => {
      expect(isOpenedSite(arming, "https://www.bank.example.test/login", true)).toBe(true);
      expect(isOpenedSite(arming, "http://www.bank.example.test/login", true)).toBe(false);
    });

    it("never a page that isn't a web address", () => {
      expect(isOpenedSite(arming, "about:blank", true)).toBe(false);
      expect(isOpenedSite(arming, "chrome-extension://id/popup/index.html", true)).toBe(false);
      expect(isOpenedSite(arming, "not a url", true)).toBe(false);
    });

    it("an http website fills its own http address", () => {
      expect(
        isOpenedSite(
          { origin: "http://printer.example.test:8080" },
          "http://printer.example.test:8080/",
          false,
        ),
      ).toBe(true);
    });
  });

  describe("OpenAndFillArmings", () => {
    const now = 1_000_000;
    let armings: OpenAndFillArmings;

    beforeEach(() => {
      armings = new OpenAndFillArmings();
      armings.arm(7, cipherId, userId, opened, now);
    });

    it("waits only so long", () => {
      expect(armings.get(7, now + OPEN_AND_FILL_WINDOW_MS - 1)).toBeDefined();
      expect(armings.get(7, now + OPEN_AND_FILL_WINDOW_MS)).toBeUndefined();
      // Gone for good, not just hidden.
      expect(armings.get(7, now)).toBeUndefined();
    });

    it("is for that tab only", () => {
      expect(armings.get(8, now)).toBeUndefined();
    });

    it("keeps going through pages of the opened site", () => {
      armings.committed(7, opened, false, true, now);
      armings.committed(7, "https://bank.example.test/signin", false, true, now);
      expect(armings.get(7, now)).toBeDefined();
    });

    it("ends at a reload", () => {
      armings.committed(7, opened, false, true, now);
      armings.committed(7, opened, true, true, now);
      expect(armings.get(7, now)).toBeUndefined();
    });

    it("counts the same address again as a reload when the browser doesn't say", () => {
      armings.committed(7, opened, undefined, true, now);
      expect(armings.get(7, now)).toBeDefined();
      armings.committed(7, opened, undefined, true, now);
      expect(armings.get(7, now)).toBeUndefined();
    });

    it("ends at a page on another site, and stays ended when the tab comes back", () => {
      armings.committed(7, "https://login.elsewhere.test/authorize", false, false, now);
      expect(armings.get(7, now)).toBeUndefined();
      armings.committed(7, opened, false, true, now);
      expect(armings.get(7, now)).toBeUndefined();
    });

    it("ends at an http copy of the site", () => {
      armings.committed(7, "http://bank.example.test/login", false, true, now);
      expect(armings.get(7, now)).toBeUndefined();
    });

    it("ignores the empty page a new tab starts with", () => {
      armings.committed(7, "about:blank", false, false, now);
      expect(armings.get(7, now)).toBeDefined();
    });

    it("ends for any account but the active one", () => {
      armings.keepOnly(userId);
      expect(armings.get(7, now)).toBeDefined();
      armings.keepOnly("user-2" as UserId);
      expect(armings.get(7, now)).toBeUndefined();
    });

    it("arms only a web address", () => {
      expect(armings.arm(9, cipherId, userId, "ssh://server.example.test", now)).toBeNull();
      expect(armings.get(9, now)).toBeUndefined();
    });
  });
});

describe("Keykeeper Open and fill: the background", () => {
  const popup = {} as chrome.runtime.MessageSender;
  const request = { cipherId, url: opened, repromptPassed: false };

  let item: CipherView;
  let status$: BehaviorSubject<AuthenticationStatus>;
  let activeAccount$: BehaviorSubject<{ id: UserId } | null>;
  let tabs: Map<number, chrome.tabs.Tab>;
  let nextTabId: number;
  let collect: jest.Mock<Observable<PageDetail[]>, [chrome.tabs.Tab]>;
  let doAutoFill: jest.Mock;
  let defaultMatch: UriMatchStrategySetting;
  let blocked: boolean;
  let copyToClipboard: jest.Mock;
  let service: KeykeeperOpenAndFill;

  const listener = (event: { addListener: unknown }) =>
    (event.addListener as jest.Mock).mock.calls.at(-1)[0];

  /** The fields of a page (or a frame) as upstream's collection describes them. */
  const page = (tab: chrome.tabs.Tab, url = tab.url!, frameId = 0, fields = 2): PageDetail => ({
    frameId,
    tab,
    details: {
      url,
      fields: Array.from({ length: fields }, (_, i) => ({ opid: `__${frameId}_${i}` })),
      forms: {},
    } as unknown as AutofillPageDetails,
  });

  /** A top-frame page arriving in the tab, as the browser reports it. */
  async function load(tabId: number, url: string, transitionType = "link") {
    const tab = tabs.get(tabId)!;
    tab.url = url;
    tab.status = "complete";
    listener(chrome.webNavigation.onCommitted)({ tabId, frameId: 0, url, transitionType });
    listener(chrome.tabs.onUpdated)(tabId, { status: "complete" }, tab);
    await jest.advanceTimersByTimeAsync(0);
  }

  async function openTab(message: object = { ...request, repromptPassed: true }) {
    const result = await service.open(message, popup);
    await jest.advanceTimersByTimeAsync(0);
    return result;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    item = bankItem();
    status$ = new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked);
    activeAccount$ = new BehaviorSubject<{ id: UserId } | null>({ id: userId });
    tabs = new Map();
    nextTabId = 7;
    defaultMatch = UriMatchStrategy.Domain;
    blocked = false;
    copyToClipboard = jest.fn();
    collect = jest.fn((tab: chrome.tabs.Tab) => of([page(tab)]));
    doAutoFill = jest.fn().mockResolvedValue({ didAutofill: true });

    jest.spyOn(BrowserApi, "createNewTab").mockImplementation(async (url: string) => {
      const tab = { id: nextTabId++, url: "", active: true, status: "loading" } as chrome.tabs.Tab;
      tabs.set(tab.id!, tab);
      return tab;
    });
    jest.spyOn(BrowserApi, "getTab").mockImplementation(async (tabId: number) => {
      const tab = tabs.get(tabId);
      if (tab == null) {
        throw new Error("No tab with id");
      }
      return { ...tab };
    });

    service = new KeykeeperOpenAndFill({
      autofillService: {
        collectPageDetailsFromTab$: collect,
        doAutoFill,
      } as unknown as AutofillService,
      cipherService: {
        getAllDecrypted: jest.fn(async () => [item]),
      } as unknown as CipherService,
      accountService: { activeAccount$ } as unknown as AccountService,
      authService: {
        activeAccountStatus$: status$,
        getAuthStatus: jest.fn(async () => status$.value),
      } as unknown as AuthService,
      passwordRepromptRequired: async (cipher) => cipher.reprompt === CipherRepromptType.Password,
      itemMatches: async (cipher, url) =>
        cipher.login.matchesUri(url, new Set<string>(), defaultMatch),
      defaultMatch: async () => defaultMatch,
      isBlocked: async () => blocked,
      copyToClipboard,
      logError: jest.fn(),
    });
    service.init();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("opens the website and fills that tab once, as the popup's Fill does, never submitting", async () => {
    expect(await openTab()).toBe(true);
    expect(BrowserApi.createNewTab).toHaveBeenCalledWith(opened, true);
    expect(service.isArmed(7)).toBe(true);

    await load(7, opened);

    expect(doAutoFill).toHaveBeenCalledTimes(1);
    expect(doAutoFill).toHaveBeenCalledWith(
      expect.objectContaining({
        cipher: item,
        tab: expect.objectContaining({ id: 7, url: opened }),
        pageDetails: [expect.objectContaining({ frameId: 0 })],
        autoSubmitLogin: false,
        allowUntrustedIframe: false,
        fillNewPassword: false,
        onlyEmptyFields: false,
        skipUsernameOnlyFill: false,
        allowTotpAutofill: true,
      }),
    );
    expect(service.isArmed(7)).toBe(false);

    // Once: the next page in the tab, even on the same site, gets nothing.
    await load(7, "https://bank.example.test/login?again=1");
    await jest.advanceTimersByTimeAsync(10_000);
    expect(doAutoFill).toHaveBeenCalledTimes(1);
  });

  it("waits for a form a script draws late, then fills it once", async () => {
    collect.mockImplementation((tab) => of([page(tab, tab.url, 0, 0)]));
    await openTab();
    await load(7, opened);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(doAutoFill).not.toHaveBeenCalled();
    expect(service.isArmed(7)).toBe(true);

    collect.mockImplementation((tab) => of([page(tab)]));
    await jest.advanceTimersByTimeAsync(3_000);
    expect(doAutoFill).toHaveBeenCalledTimes(1);
    expect(service.isArmed(7)).toBe(false);
  });

  it("tries again when upstream found nothing to fill yet", async () => {
    doAutoFill.mockResolvedValueOnce({ didAutofill: false });
    await openTab();
    await load(7, opened);
    expect(service.isArmed(7)).toBe(true);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(doAutoFill).toHaveBeenCalledTimes(2);
    expect(service.isArmed(7)).toBe(false);
  });

  it("gives a username alone (a two-step sign-in) only to a page that finished loading", async () => {
    await openTab();
    tabs.get(7)!.url = opened;
    tabs.get(7)!.status = "loading";
    doAutoFill.mockResolvedValue({ didAutofill: false });
    await jest.advanceTimersByTimeAsync(300);
    expect(doAutoFill).toHaveBeenLastCalledWith(
      expect.objectContaining({ skipUsernameOnlyFill: true }),
    );
    doAutoFill.mockResolvedValue({ didAutofill: true });
    await load(7, opened);
    expect(doAutoFill).toHaveBeenLastCalledWith(
      expect.objectContaining({ skipUsernameOnlyFill: false }),
    );
  });

  it("never fills another tab, even on the same site", async () => {
    await openTab();
    tabs.set(8, { id: 8, url: opened, active: true, status: "complete" } as chrome.tabs.Tab);
    listener(chrome.tabs.onUpdated)(8, { status: "complete" }, tabs.get(8));
    listener(chrome.tabs.onActivated)({ tabId: 8, windowId: 1 });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(doAutoFill).not.toHaveBeenCalledWith(
      expect.objectContaining({ tab: expect.objectContaining({ id: 8 }) }),
    );
    expect(service.isArmed(8)).toBe(false);
  });

  it("never fills its tab while another is in front, and fills when it's back", async () => {
    await openTab();
    tabs.get(7)!.active = false;
    await load(7, opened);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(doAutoFill).not.toHaveBeenCalled();

    tabs.get(7)!.active = true;
    listener(chrome.tabs.onActivated)({ tabId: 7, windowId: 1 });
    await jest.advanceTimersByTimeAsync(0);
    expect(doAutoFill).toHaveBeenCalledTimes(1);
  });

  it("ends at a reload before it filled", async () => {
    collect.mockImplementation((tab) => of([page(tab, tab.url, 0, 0)]));
    await openTab();
    await load(7, opened);
    await load(7, opened, "reload");
    expect(service.isArmed(7)).toBe(false);

    collect.mockImplementation((tab) => of([page(tab)]));
    await load(7, opened);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(doAutoFill).not.toHaveBeenCalled();
  });

  it("gives a redirect to another site nothing, nor the page it sends back to", async () => {
    await openTab();
    await load(7, "https://login.elsewhere.test/authorize");
    expect(service.isArmed(7)).toBe(false);
    await load(7, opened);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(doAutoFill).not.toHaveBeenCalled();
  });

  it("gives nothing to another site the tab shows, even when the browser didn't say it went there", async () => {
    await openTab();
    tabs.get(7)!.url = "https://login.elsewhere.test/authorize";
    tabs.get(7)!.status = "complete";
    listener(chrome.tabs.onUpdated)(7, { status: "complete" }, tabs.get(7));
    await jest.advanceTimersByTimeAsync(0);
    expect(service.isArmed(7)).toBe(false);
    expect(doAutoFill).not.toHaveBeenCalled();
  });

  it("gives an http copy of the site nothing", async () => {
    await openTab();
    await load(7, "http://bank.example.test/login");
    await jest.advanceTimersByTimeAsync(10_000);
    expect(doAutoFill).not.toHaveBeenCalled();
    expect(service.isArmed(7)).toBe(false);
  });

  it("fills a redirect within the site, and another of the login's websites by its match settings", async () => {
    await openTab();
    await load(7, "https://bank.example.test/signin?next=%2F");
    expect(doAutoFill).toHaveBeenCalledTimes(1);

    // Upstream's default match is the base domain, so www. is the same login.
    await openTab();
    await load(8, "https://www.bank.example.test/login");
    expect(doAutoFill).toHaveBeenCalledTimes(2);
  });

  it("follows the person's match settings for another host", async () => {
    item = bankItem([{ uri: opened, match: UriMatchStrategy.Host }]);
    await openTab();
    await load(7, "https://www.bank.example.test/login");
    await jest.advanceTimersByTimeAsync(10_000);
    expect(doAutoFill).not.toHaveBeenCalled();
  });

  it("runs out", async () => {
    collect.mockImplementation((tab) => of([page(tab, tab.url, 0, 0)]));
    await openTab();
    await load(7, opened);
    await jest.advanceTimersByTimeAsync(OPEN_AND_FILL_WINDOW_MS);
    expect(service.isArmed(7)).toBe(false);

    collect.mockImplementation((tab) => of([page(tab)]));
    listener(chrome.tabs.onUpdated)(7, { status: "complete" }, tabs.get(7));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(doAutoFill).not.toHaveBeenCalled();
  });

  it("fills only frames whose own address is the site", async () => {
    collect.mockImplementation((tab) =>
      of([page(tab), page(tab, "https://ads.elsewhere.test/frame", 3)]),
    );
    await openTab();
    await load(7, opened);
    expect(doAutoFill).toHaveBeenCalledWith(
      expect.objectContaining({ pageDetails: [expect.objectContaining({ frameId: 0 })] }),
    );
  });

  it("fills nothing when the page moved on while its fields were read", async () => {
    collect.mockImplementationOnce((tab) => {
      tabs.get(7)!.url = "https://bank.example.test/elsewhere";
      return of([page(tab)]);
    });
    await openTab();
    tabs.get(7)!.url = opened;
    tabs.get(7)!.status = "complete";
    listener(chrome.tabs.onUpdated)(7, { status: "complete" }, tabs.get(7));
    await jest.advanceTimersByTimeAsync(0);
    expect(doAutoFill).not.toHaveBeenCalledWith(
      expect.objectContaining({ tab: expect.objectContaining({ url: opened }) }),
    );
  });

  it("gives a site on the person's blocked list nothing", async () => {
    blocked = true;
    await openTab();
    await load(7, opened);
    expect(doAutoFill).not.toHaveBeenCalled();
    expect(service.isArmed(7)).toBe(false);
  });

  it("ends every waiting fill when the vault locks or the account changes", async () => {
    await openTab();
    status$.next(AuthenticationStatus.Locked);
    expect(service.isArmed(7)).toBe(false);

    status$.next(AuthenticationStatus.Unlocked);
    await openTab();
    activeAccount$.next({ id: "user-2" as UserId });
    expect(service.isArmed(8)).toBe(false);
  });

  it("copies the one-time code when upstream's fill hands one back", async () => {
    doAutoFill.mockResolvedValue({ didAutofill: true, totp: "123456" });
    await openTab();
    await load(7, opened);
    expect(copyToClipboard).toHaveBeenCalledWith("123456");
  });

  describe("opening", () => {
    it("takes requests only from the extension's own pages", async () => {
      const contentScript = {
        tab: { id: 3 },
        frameId: 0,
        url: "https://evil.example.test/",
      } as chrome.runtime.MessageSender;
      expect(await service.open({ ...request, repromptPassed: true }, contentScript)).toBe(false);
      expect(BrowserApi.createNewTab).not.toHaveBeenCalled();
    });

    it("opens only one of the item's own websites", async () => {
      expect(
        await openTab({ ...request, url: "https://evil.example.test/", repromptPassed: true }),
      ).toBe(false);
      expect(await openTab({ ...request, cipherId: "another", repromptPassed: true })).toBe(false);
      expect(BrowserApi.createNewTab).not.toHaveBeenCalled();
    });

    it("needs the master password asked first, for an item that asks for it", async () => {
      item.reprompt = CipherRepromptType.Password;
      expect(await openTab({ ...request, repromptPassed: false })).toBe(false);
      expect(BrowserApi.createNewTab).not.toHaveBeenCalled();
      expect(await openTab({ ...request, repromptPassed: true })).toBe(true);
    });

    it("needs the vault unlocked", async () => {
      status$.next(AuthenticationStatus.Locked);
      expect(await openTab()).toBe(false);
      expect(BrowserApi.createNewTab).not.toHaveBeenCalled();
    });

    it("only opens a website the person's default says never fills", async () => {
      defaultMatch = UriMatchStrategy.Never;
      expect(await openTab()).toBe(true);
      expect(BrowserApi.createNewTab).toHaveBeenCalled();
      expect(service.isArmed(7)).toBe(false);
    });
  });
});
