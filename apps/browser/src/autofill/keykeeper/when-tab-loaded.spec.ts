import { mock } from "jest-mock-extended";

import { BrowserApi } from "../../platform/browser/browser-api";
import { flushPromises, triggerWebNavigationOnCompletedEvent } from "../spec/testing-utils";

import { TAB_LOADED_CHECKS_MS, TAB_LOADED_GIVE_UP_MS, whenTabLoaded } from "./when-tab-loaded";

describe("whenTabLoaded", () => {
  const tabId = 7;
  let status: chrome.tabs.Tab["status"];
  let getTab: jest.SpyInstance;
  let loaded: jest.Mock;
  let onError: jest.Mock;

  const navigated = (details: Partial<chrome.webNavigation.WebNavigationFramedCallbackDetails>) =>
    triggerWebNavigationOnCompletedEvent(
      mock<chrome.webNavigation.WebNavigationFramedCallbackDetails>({
        tabId,
        frameId: 0,
        ...details,
      }),
    );

  beforeEach(() => {
    jest.useFakeTimers();
    status = "loading";
    getTab = jest
      .spyOn(BrowserApi, "getTab")
      .mockImplementation(async (id) => ({ id, status }) as chrome.tabs.Tab);
    loaded = jest.fn().mockResolvedValue(undefined);
    onError = jest.fn();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    (chrome.webNavigation.onCompleted.addListener as unknown as jest.Mock).mockClear();
  });

  // The bug: the page finished loading before the browser had the listener,
  // so no navigation event ever came, and the prompt was lost.
  it("goes on when the page already finished loading, with no navigation event", async () => {
    whenTabLoaded(tabId, () => true, loaded, onError);
    status = "complete";

    jest.advanceTimersByTime(0);
    await flushPromises();

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledWith(expect.objectContaining({ id: tabId }));
    expect(chrome.webNavigation.onCompleted.removeListener).toHaveBeenCalled();
  });

  it("goes on when the tab's page finishes loading later", async () => {
    whenTabLoaded(tabId, () => true, loaded, onError);
    jest.advanceTimersByTime(0);
    await flushPromises();
    expect(loaded).not.toHaveBeenCalled();

    status = "complete";
    navigated({});
    await flushPromises();

    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("goes on at the tab's own page finishing, whatever the tab's status says, as upstream did", async () => {
    whenTabLoaded(tabId, () => true, loaded, onError);

    navigated({ frameId: 0 });
    await flushPromises();

    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("goes on once, though the navigation event and every check see the page loaded", async () => {
    whenTabLoaded(tabId, () => true, loaded, onError);
    status = "complete";

    navigated({});
    jest.advanceTimersByTime(Math.max(...TAB_LOADED_CHECKS_MS));
    await flushPromises();
    navigated({});
    await flushPromises();

    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("ignores other tabs' pages", async () => {
    whenTabLoaded(tabId, () => true, loaded, onError);

    navigated({ tabId: tabId + 1 });
    await flushPromises();

    expect(getTab).not.toHaveBeenCalled();
    expect(loaded).not.toHaveBeenCalled();
  });

  it("checks again after the first look, for a page that finishes between checks", async () => {
    whenTabLoaded(tabId, () => true, loaded, onError);
    jest.advanceTimersByTime(0);
    await flushPromises();
    status = "complete";

    jest.advanceTimersByTime(TAB_LOADED_CHECKS_MS[1]);
    await flushPromises();

    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("does nothing once the submission was handled some other way", async () => {
    let wanted = true;
    whenTabLoaded(tabId, () => wanted, loaded, onError);
    wanted = false;
    status = "complete";

    jest.advanceTimersByTime(Math.max(...TAB_LOADED_CHECKS_MS));
    navigated({});
    await flushPromises();

    expect(loaded).not.toHaveBeenCalled();
  });

  it("stops waiting when the tab is gone", async () => {
    getTab.mockRejectedValue(new Error("No tab with id: 7."));
    whenTabLoaded(tabId, () => true, loaded, onError);

    jest.advanceTimersByTime(0);
    await flushPromises();

    expect(chrome.webNavigation.onCompleted.removeListener).toHaveBeenCalled();
    expect(loaded).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("gives up after a minute", async () => {
    whenTabLoaded(tabId, () => true, loaded, onError);

    jest.advanceTimersByTime(TAB_LOADED_GIVE_UP_MS);
    await flushPromises();
    status = "complete";
    navigated({});
    await flushPromises();

    expect(loaded).not.toHaveBeenCalled();
    expect(chrome.webNavigation.onCompleted.removeListener).toHaveBeenCalled();
  });

  it("reports an error from going on", async () => {
    loaded.mockRejectedValue(new Error("no prompt"));
    status = "complete";
    whenTabLoaded(tabId, () => true, loaded, onError);

    jest.advanceTimersByTime(0);
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(new Error("no prompt"));
  });
});
