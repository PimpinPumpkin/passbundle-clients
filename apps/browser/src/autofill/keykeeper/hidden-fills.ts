// Keykeeper: the "Save login?" and "Update password?" prompts never offer to
// save a password the person can't see (DESIGN.md, "Folders and
// permissions"). Filling an item whose shared folders hide its passwords puts
// the password in the page; if the prompt then offered to save what the page
// sent, it would copy that password into an item of the person's own.
//
// So the background remembers, per tab, the site where an item that hides its
// passwords filled last, and the prompts stay quiet there until another item
// fills it. They also stay quiet when the password sent is one of a hidden
// item's for the site, however it got into the page.

import { Utils } from "@bitwarden/common/platform/misc/utils";
import { maySeeSecrets, SecretsLike } from "@bitwarden/common/vault/keykeeper/hidden-secrets";

/** The site an item that hides its passwords filled last, by tab. (Tab ids aren't reused.) */
const hiddenFills = new Map<number, string>();

/** Notes that an item filled a tab's page. */
export function noteFill(
  tabId: number | null | undefined,
  url: string | null | undefined,
  item: SecretsLike,
): void {
  if (tabId == null) {
    return;
  }
  const domain = Utils.getDomain(url ?? "");
  if (!maySeeSecrets(item) && domain != null) {
    hiddenFills.set(tabId, domain);
  } else {
    hiddenFills.delete(tabId);
  }
}

/** Whether the item that filled this tab's page on this site last hides its passwords. */
export function lastFillHides(
  tabId: number | null | undefined,
  url: string | null | undefined,
): boolean {
  if (tabId == null) {
    return false;
  }
  const domain = Utils.getDomain(url ?? "");
  return domain != null && hiddenFills.get(tabId) === domain;
}

/** An item, as far as its password goes. */
type LoginItem = SecretsLike & { login?: { password?: string | null } | null };

/**
 * Whether a password a page sent is one the person can't see: the password of
 * one of the site's items whose shared folders hide it.
 */
export function isHiddenPassword(
  items: LoginItem[],
  ...passwords: (string | null | undefined)[]
): boolean {
  const sent = passwords.filter((p): p is string => !!p);
  return (
    sent.length > 0 &&
    items.some(
      (item) =>
        !maySeeSecrets(item) && !!item.login?.password && sent.includes(item.login.password),
    )
  );
}
