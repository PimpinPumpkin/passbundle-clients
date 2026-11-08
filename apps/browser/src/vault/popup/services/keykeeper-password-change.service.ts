// Keykeeper: the popup's half of assisted password change (DESIGN.md,
// "Assisted password change"). The background opens the tab and does the
// change (autofill/keykeeper/password-change/); the popup asks for the master
// password if the item asks for it, says what happens next, and asks the
// background to start.

import { inject, Injectable } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  mayChangePassword,
  organizationAllowsPasswordChange,
  passwordChangeWebsite,
} from "@bitwarden/common/vault/keykeeper/password-change";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogService, ToastService } from "@bitwarden/components";
import { KeykeeperPasswordChangeService, PasswordRepromptService } from "@bitwarden/vault";

import {
  PASSWORD_CHANGE_START,
  PASSWORD_CHANGE_STATUS,
  StartAnswer,
  StartRefusal,
} from "../../../autofill/keykeeper/password-change/password-change-messages";
import { BrowserApi } from "../../../platform/browser/browser-api";
import BrowserPopupUtils from "../../../platform/browser/browser-popup-utils";

/** Why it didn't start, in words. */
const REFUSALS: Record<StartRefusal, string> = {
  running: "keykeeperPasswordChangeNotStartedRunning",
  notAllowed: "keykeeperPasswordChangeNotStartedNotAllowed",
  noWebsite: "keykeeperPasswordChangeNotStartedNoWebsite",
  locked: "keykeeperPasswordChangeNotStartedLocked",
  reprompt: "keykeeperPasswordChangeNotStartedReprompt",
};

@Injectable()
export class BrowserPasswordChangeService extends KeykeeperPasswordChangeService {
  private readonly dialogService = inject(DialogService);
  private readonly i18nService = inject(I18nService);
  private readonly passwordRepromptService = inject(PasswordRepromptService);
  private readonly toastService = inject(ToastService);

  available(cipher: CipherView): boolean {
    return mayChangePassword(cipher, organizationAllowsPasswordChange);
  }

  async confirmAndStart(cipher: CipherView): Promise<boolean> {
    if (!this.available(cipher)) {
      return false;
    }
    if (!(await this.passwordRepromptService.passwordRepromptCheck(cipher))) {
      return false;
    }
    const website = passwordChangeWebsite(cipher.login.uris);
    const site = website == null ? "" : new URL(website).host;
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "keykeeperPasswordChangeConfirmTitle", placeholders: [site] },
      content: { key: "keykeeperPasswordChangeConfirmText" },
      acceptButtonText: { key: "changePassword" },
      type: "info",
    });
    if (!confirmed) {
      return false;
    }
    // The new tab takes focus, which can close the popup before any answer,
    // so the background does everything and the popup only asks.
    const answer = await BrowserApi.sendMessageWithResponse<{ result?: StartAnswer }>(
      PASSWORD_CHANGE_START,
      { cipherId: cipher.id, repromptPassed: true },
    );
    const result = answer?.result;
    if (result?.started) {
      if (BrowserPopupUtils.inPopup(window)) {
        BrowserApi.closePopup(window);
      }
      return true;
    }
    const reason: StartRefusal = result?.started === false ? result.reason : "notAllowed";
    this.toastService.showToast({
      variant: "error",
      message: this.i18nService.t(REFUSALS[reason] ?? REFUSALS.notAllowed),
    });
    return false;
  }

  async status(cipherId: string): Promise<{ running: boolean; text: string } | null> {
    const answer = await BrowserApi.sendMessageWithResponse<{
      result?: { running: boolean; text: string } | null;
    }>(PASSWORD_CHANGE_STATUS, { cipherId });
    return answer?.result ?? null;
  }
}
