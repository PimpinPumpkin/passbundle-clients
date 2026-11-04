// Keykeeper: the prompt before a sensitive change (DESIGN.md, "Confirming
// sensitive changes"). The server makes a provisioning token, saves single
// sign-on settings, adds or changes an event destination or makes its
// signing secret, and makes a script token only with the person's master
// password, or a code emailed to an account without one, so a session alone
// (one single sign-on started, say) can't. This asks with upstream's
// verification prompt and sends the change with that proof.

import { Injectable } from "@angular/core";

import { ChangeVerification, verificationFields } from "@bitwarden/admin-console/common";
import { UserVerificationDialogComponent } from "@bitwarden/auth/angular";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { DialogService } from "@bitwarden/components";

/**
 * The server's answers to a wrong master password or code, in upstream's
 * words. They keep the prompt open, marked wrong, to try again (or send a new
 * code).
 */
const WRONG_SECRET = [
  "Invalid password",
  "Token is invalid",
  "Token has expired",
  "Protected action token not found",
];

/** Whether the server refused the person's master password or code, rather than the change. */
export function isWrongSecret(e: unknown): boolean {
  if (!(e instanceof ErrorResponse) || e.statusCode !== 400) {
    return false;
  }
  const message = e.getSingleMessage() ?? "";
  return WRONG_SECRET.some((wrong) => message.startsWith(wrong));
}

@Injectable({ providedIn: "root" })
export class KeykeeperConfirmChangeService {
  constructor(
    private readonly dialogService: DialogService,
    private readonly userVerificationService: UserVerificationService,
  ) {}

  /**
   * Asks the person to confirm it's them, then sends the change with their
   * proof. Resolves to the server's answer, or undefined when they cancel:
   * then nothing was sent. A wrong password or code keeps the prompt open;
   * any other refusal closes it and is thrown, for the page to show.
   *
   * @param bodyText What the change is, as an i18n key.
   * @param change Sends the change with the proof.
   */
  async send<T>(
    bodyText: string,
    change: (verification: ChangeVerification) => Promise<T>,
  ): Promise<T | undefined> {
    const outcome: { answer?: { value: T }; refusal?: { error: unknown } } = {};
    await UserVerificationDialogComponent.open(this.dialogService, {
      bodyText,
      confirmButtonOptions: { text: "continue", type: "primary" },
      verificationType: {
        type: "custom",
        verificationFn: async (secret) => {
          const request = await this.userVerificationService.buildRequest(secret);
          try {
            outcome.answer = { value: await change(verificationFields(request)) };
            return true;
          } catch (e) {
            if (isWrongSecret(e)) {
              throw e;
            }
            outcome.refusal = { error: e };
            return false;
          }
        },
      },
    });
    if (outcome.refusal != null) {
      throw outcome.refusal.error;
    }
    return outcome.answer?.value;
  }
}
