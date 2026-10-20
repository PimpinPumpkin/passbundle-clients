// Keykeeper: an MSP's background work in the browser extension: confirming
// members waiting for their org key, and keeping clients' copies of the MSP's
// templates current (see KeykeeperMspWork in @bitwarden/admin-console). It
// runs when the person unlocks, when their items change, and every few
// minutes, because a member joining a client doesn't change anything in the
// MSP staff member's own vault.

import { KeykeeperMspWork } from "@bitwarden/admin-console/common";

import { BrowserApi } from "../platform/browser/browser-api";

export const MSP_WORK_ALARM = "keykeeper-msp-work";
const EVERY_MINUTES = 5;

export function startMspWork(work: KeykeeperMspWork) {
  work.start();
  // Said on this device, so an unexpected one is seen where it happened.
  work.letIn$.subscribe(({ email, organizationName }) => {
    void chrome.notifications?.create(`${MSP_WORK_ALARM}-${email}-${organizationName}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("images/icon128.png"),
      title: `Let ${email} into ${organizationName}`,
      message: "This browser let them in. If you don't know them, remove them on the Members page.",
      priority: 1,
    });
  });
  if (!chrome.alarms) {
    return;
  }
  BrowserApi.addListener(chrome.alarms.onAlarm, (alarm: chrome.alarms.Alarm) => {
    if (alarm.name === MSP_WORK_ALARM) {
      void work.run();
    }
  });
  void chrome.alarms.create(MSP_WORK_ALARM, { delayInMinutes: 1, periodInMinutes: EVERY_MINUTES });
}
