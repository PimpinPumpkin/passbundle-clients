// Keykeeper: which messages come from the extension's own pages. A content
// script runs in every web page and can send the background any message, so
// a message that unlocks, enrolls, or answers a master password prompt is
// taken only from the extension itself.

/**
 * Whether a message came from one of the extension's own pages: the popup
 * (no tab), or the top frame of a tab that shows an extension page, such as a
 * popout. Never a content script, and never an extension page framed inside a
 * web page (the inline menu, say), where the page around it can trick a click.
 */
export function fromExtensionPage(sender: chrome.runtime.MessageSender | undefined): boolean {
  if (sender == null || sender.id !== chrome.runtime.id) {
    return false;
  }
  if (sender.tab == null) {
    return true;
  }
  const own = chrome.runtime.getURL("");
  return sender.frameId === 0 && typeof sender.url === "string" && sender.url.startsWith(own);
}
