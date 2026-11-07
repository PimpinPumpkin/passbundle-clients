// Keykeeper: "Open and fill" (DESIGN.md, "Open and fill"), for the item
// view's websites. The browser extension provides it; where nothing does (the
// web vault), a website only opens.

import { OpenAndFillWebsite } from "@bitwarden/common/vault/keykeeper/open-and-fill";

export abstract class KeykeeperOpenAndFillService {
  /** The address "Open and fill" opens for a website, or null when it only opens. */
  abstract urlFor(website: OpenAndFillWebsite): string | null;
  /**
   * Opens the address in a new tab, which the extension fills once. The
   * caller has already asked for the master password, if the item asks for it.
   */
  abstract open(cipherId: string, url: string): Promise<boolean>;
}
