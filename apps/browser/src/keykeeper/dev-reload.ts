// Keykeeper: a test build loaded unpacked reloads itself when its files are
// replaced by a newer build. On the user's Mac, a background job (the ops
// repo's passbundle-test/extension-updater.sh) swaps the folder Chrome loads
// it from and writes pb-build.txt, naming the build. Chrome doesn't reload an
// unpacked extension by itself, so this notices the file changed and reloads.
// Only installs Chrome reports as "development" (loaded unpacked) check; a
// store or policy install never does.

import { BrowserApi } from "../platform/browser/browser-api";

export const DEV_RELOAD_ALARM = "keykeeper-dev-reload";
export const BUILD_FILE = "pb-build.txt";
/** The build this copy of the extension started with; cleared by a reload. */
export const LOADED_BUILD_KEY = "keykeeper.loadedBuild";
const CHECK_EVERY_MINUTES = 1;

/** The build named in the extension's folder now, or "" without one. */
export async function buildOnDisk(fetchFn: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetchFn(chrome.runtime.getURL(BUILD_FILE), { cache: "no-store" });
    return response.ok ? (await response.text()).trim() : "";
  } catch {
    return "";
  }
}

/** Whether the files on disk are another build than the one running. */
export function shouldReload(loaded: string | undefined, onDisk: string): boolean {
  return loaded !== undefined && loaded !== onDisk;
}

export class KeykeeperDevReload {
  constructor(private fetchFn: typeof fetch = fetch) {}

  async init() {
    if (!chrome.management?.getSelf || !chrome.alarms || !chrome.storage?.session) {
      return;
    }
    const self = await chrome.management.getSelf();
    if (self.installType !== "development") {
      return;
    }
    BrowserApi.addListener(chrome.alarms.onAlarm, (alarm: chrome.alarms.Alarm) => {
      if (alarm.name === DEV_RELOAD_ALARM) {
        void this.check();
      }
    });
    void chrome.alarms.create(DEV_RELOAD_ALARM, {
      delayInMinutes: CHECK_EVERY_MINUTES,
      periodInMinutes: CHECK_EVERY_MINUTES,
    });
    await this.check();
  }

  /**
   * Remembers the build on the first check after a (re)load. Later, the
   * service worker may restart with the new files while pages still run the
   * old ones, so any difference from what was remembered means reload.
   */
  async check() {
    const onDisk = await buildOnDisk(this.fetchFn);
    const stored = await chrome.storage.session.get(LOADED_BUILD_KEY);
    const loaded = stored[LOADED_BUILD_KEY] as string | undefined;
    if (loaded === undefined) {
      await chrome.storage.session.set({ [LOADED_BUILD_KEY]: onDisk });
      return;
    }
    if (shouldReload(loaded, onDisk)) {
      chrome.runtime.reload();
    }
  }
}
