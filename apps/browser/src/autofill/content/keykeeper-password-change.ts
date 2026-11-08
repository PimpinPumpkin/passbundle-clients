// Keykeeper: the content script of an assisted password change (DESIGN.md,
// "Assisted password change"). The background injects it into the top frame
// of the one tab it opened for a change; see
// keykeeper/password-change/password-change-content.ts for what it does.

import { PasswordChangeContent } from "../keykeeper/password-change/password-change-content";
import { CollectAutofillContentService } from "../services/collect-autofill-content.service";
import DomElementVisibilityService from "../services/dom-element-visibility.service";
import { DomQueryService } from "../services/dom-query.service";
import InsertAutofillContentService from "../services/insert-autofill-content.service";
import { sendExtensionMessage } from "../utils";

(function (globalContext) {
  // Injected again on a page that has it already (each step checks), it runs once.
  const marker = "__keykeeperPasswordChange";
  const context = globalContext as unknown as Record<string, unknown>;
  if (context[marker]) {
    return;
  }
  context[marker] = true;

  const content = new PasswordChangeContent(
    globalContext.document,
    () => {
      const domQueryService = new DomQueryService();
      const domElementVisibilityService = new DomElementVisibilityService();
      const collect = new CollectAutofillContentService(
        domElementVisibilityService,
        domQueryService,
      );
      const insert = new InsertAutofillContentService(domElementVisibilityService, collect);
      return { collect, insert };
    },
    // While it fills, the menu inside the field stays closed, as for auto-submit.
    (filling) =>
      void sendExtensionMessage("updateIsFieldCurrentlyFilling", {
        isFieldCurrentlyFilling: filling,
      }),
  );

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only the extension itself (its background) sends a tab's content scripts messages.
    if (sender?.id !== chrome.runtime.id) {
      return false;
    }
    const answer = content.handle(message);
    if (answer == null) {
      return false;
    }
    answer.then(
      (value) => sendResponse(value),
      () => sendResponse(undefined),
    );
    return true;
  });
})(globalThis);
