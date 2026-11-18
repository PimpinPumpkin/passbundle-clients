// Keykeeper: the nudges about two-step login, shared by the web vault's vault
// page and the extension's popup: to set it up, for someone with none at
// all, and to add a stronger method, for someone whose only second step is
// email codes. See DESIGN.md, "A nudge for everyone else".

import { KeykeeperMspRequests } from "./msp-requests";
import { TwoStepNudgeKind } from "./msp-types";

/** What each nudge says, in the web vault, the extension, and the apps alike. */
export const TWO_STEP_NUDGE = {
  setUp: "Set it up",
  notNow: "Not now",
  words: {
    setUp: {
      title: "Add two-step login",
      text: "Your password is all that protects your account. Add a second step, such as an authenticator app, so a stolen password isn't enough.",
    },
    stronger: {
      title: "Add a stronger second step",
      text: "Codes by email are only as safe as your email account. An authenticator app or a security key is safer.",
    },
  },
} as const;

/**
 * Which nudge shows, if any, and "Not now". The server decides who sees
 * which (someone whom no rule covers, with no two-step login at all or with
 * email codes alone) and keeps the dismissal for the account, one for both,
 * so it's the same on every device. Nothing here ever throws or waits: a
 * server that can't be asked shows nothing, and a dismissal that can't be
 * saved still hides it now.
 */
export class KeykeeperTwoStepNudge {
  private shown: TwoStepNudgeKind | null = null;

  constructor(
    private readonly requests: Pick<KeykeeperMspRequests, "twoStepNudge" | "dismissTwoStepNudge">,
  ) {}

  /** The nudge showing, or null. */
  get nudge(): TwoStepNudgeKind | null {
    return this.shown;
  }

  get show(): boolean {
    return this.shown !== null;
  }

  /** Asks the server. */
  async load(): Promise<TwoStepNudgeKind | null> {
    this.shown = await this.requests.twoStepNudge();
    return this.shown;
  }

  /** "Not now": hidden here at once, and for 90 days on every device once the server has it. */
  async notNow(): Promise<void> {
    this.shown = null;
    try {
      await this.requests.dismissTwoStepNudge();
    } catch {
      // It shows again the next time the vault opens; nothing waits on it.
    }
  }
}
