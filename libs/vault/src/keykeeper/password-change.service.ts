// Keykeeper: assisted password change (DESIGN.md, "Assisted password change"),
// for the item view and Health. The browser extension provides it; where
// nothing does (the web vault), Change password only opens the site's page,
// and the item's card still answers an unfinished change.

import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

export abstract class KeykeeperPasswordChangeService {
  /** Whether the person may start a change on the item here. */
  abstract available(cipher: CipherView): boolean;
  /**
   * Asks for the master password if the item asks for it, says what happens
   * next, and starts the change when the person confirms. Answers whether it
   * started.
   */
  abstract confirmAndStart(cipher: CipherView): Promise<boolean>;
  /** How a change for the item that's running in this browser is going, or null. */
  abstract status(cipherId: string): Promise<{ running: boolean; text: string } | null>;
}
