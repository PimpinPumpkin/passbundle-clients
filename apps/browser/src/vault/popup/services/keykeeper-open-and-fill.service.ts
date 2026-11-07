// Keykeeper: the popup's half of "Open and fill" (DESIGN.md, "Open and
// fill"). The background opens the tab, so it knows the tab is one it just
// opened, and fills it once (autofill/keykeeper/open-and-fill.ts).

import { Injectable } from "@angular/core";

import {
  OpenAndFillWebsite,
  openAndFillUrl,
} from "@bitwarden/common/vault/keykeeper/open-and-fill";
import { KeykeeperOpenAndFillService } from "@bitwarden/vault";

import { OPEN_AND_FILL } from "../../../autofill/keykeeper/open-and-fill-message";
import { BrowserApi } from "../../../platform/browser/browser-api";
import BrowserPopupUtils from "../../../platform/browser/browser-popup-utils";

@Injectable()
export class BrowserOpenAndFillService extends KeykeeperOpenAndFillService {
  urlFor(website: OpenAndFillWebsite): string | null {
    return openAndFillUrl(website);
  }

  async open(cipherId: string, url: string): Promise<boolean> {
    // The new tab takes focus, which closes the popup before any answer, so
    // the background does everything and the popup only asks. Callers have
    // asked for the master password already, for an item that asks for it.
    const answer = await BrowserApi.sendMessageWithResponse<{ result?: boolean }>(OPEN_AND_FILL, {
      cipherId,
      url,
      repromptPassed: true,
    });
    const opened = answer?.result === true;
    if (opened && BrowserPopupUtils.inPopup(window)) {
      BrowserApi.closePopup(window);
    }
    return opened;
  }
}
