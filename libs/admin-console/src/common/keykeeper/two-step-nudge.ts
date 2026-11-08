// Keykeeper: the nudge to set up two-step login, shared by the web vault's
// vault page and the extension's popup. See DESIGN.md, "A nudge for everyone
// else".

import { KeykeeperMspRequests } from "./msp-requests";

/** What the nudge says, in the web vault and the extension alike. */
export const TWO_STEP_NUDGE = {
  title: "Add two-step login",
  text: "Your password is all that protects your account. Add a second step, such as an authenticator app, so a stolen password isn't enough.",
  setUp: "Set it up",
  notNow: "Not now",
} as const;

/**
 * Whether the nudge shows, and "Not now". The server decides who sees it
 * (someone with no two-step login at all whom no rule covers) and keeps the
 * dismissal for the account, so it's the same on every device. Nothing here
 * ever throws or waits: a server that can't be asked shows nothing, and a
 * dismissal that can't be saved still hides it now.
 */
export class KeykeeperTwoStepNudge {
  private shown = false;

  constructor(
    private readonly requests: Pick<KeykeeperMspRequests, "twoStepNudge" | "dismissTwoStepNudge">,
  ) {}

  get show(): boolean {
    return this.shown;
  }

  /** Asks the server. */
  async load(): Promise<boolean> {
    this.shown = await this.requests.twoStepNudge();
    return this.shown;
  }

  /** "Not now": hidden here at once, and for 90 days on every device once the server has it. */
  async notNow(): Promise<void> {
    this.shown = false;
    try {
      await this.requests.dismissTwoStepNudge();
    } catch {
      // It shows again the next time the vault opens; nothing waits on it.
    }
  }
}
