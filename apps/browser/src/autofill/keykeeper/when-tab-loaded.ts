// Keykeeper: waiting for the page a sign-in lands on, without missing it
// (DESIGN.md, "Missed save prompts on fast sites"). The save and update
// prompts wait until the tab has loaded the page after a submission. Upstream
// waited by adding a webNavigation listener once the sign-in request was done,
// but on a site that answers at once the new page has often finished loading
// before the browser has the listener, and the prompt was then lost without a
// word. Here the tab is also checked right after the listener is added and a
// few times after that, and whichever sees the page loaded first runs, once.

import { BrowserApi } from "../../platform/browser/browser-api";

/** When the tab is checked again, in milliseconds after the wait starts. */
export const TAB_LOADED_CHECKS_MS = [0, 250, 1000, 3000];

/** How long the wait lasts at most. A submission's data is kept no longer. */
export const TAB_LOADED_GIVE_UP_MS = 60_000;

/**
 * Runs `loaded` once, with the tab, as soon as it has finished loading: on
 * the tab's own navigation event, or when a check finds it complete. Nothing
 * runs once `stillWanted` says no (another path already handled this
 * submission), or after the wait gives up.
 */
export function whenTabLoaded(
  tabId: number,
  stillWanted: () => boolean,
  loaded: (tab: chrome.tabs.Tab) => Promise<unknown>,
  onError: (error: unknown) => void,
): void {
  let finished = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const finish = () => {
    finished = true;
    BrowserApi.removeListener(chrome.webNavigation.onCompleted, onNavigationCompleted);
    timers.forEach((timer) => clearTimeout(timer));
  };

  // `mainFrameDone`: the tab's own page said it finished. Upstream went on at
  // that point whatever the tab's status said, so this does too.
  const check = async (mainFrameDone: boolean) => {
    if (finished) {
      return;
    }
    if (!stillWanted()) {
      finish();
      return;
    }
    let tab: chrome.tabs.Tab | null = null;
    try {
      tab = await BrowserApi.getTab(tabId);
    } catch {
      // The tab is gone.
      finish();
      return;
    }
    if (finished || !tab || (!mainFrameDone && tab.status !== "complete")) {
      return;
    }
    finish();
    await loaded(tab);
  };

  const run = (mainFrameDone: boolean) => {
    check(mainFrameDone).catch((error) => {
      finish();
      onError(error);
    });
  };

  function onNavigationCompleted(details: chrome.webNavigation.WebNavigationFramedCallbackDetails) {
    // Only this tab's pages count; another tab finishing says nothing about this one.
    if (details.tabId === tabId) {
      run(details.frameId === 0);
    }
  }

  BrowserApi.addListener(chrome.webNavigation.onCompleted, onNavigationCompleted);
  for (const ms of TAB_LOADED_CHECKS_MS) {
    timers.push(setTimeout(() => run(false), ms));
  }
  timers.push(setTimeout(finish, TAB_LOADED_GIVE_UP_MS));
}
