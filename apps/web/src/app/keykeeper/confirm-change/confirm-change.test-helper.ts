// Test helper for pages that confirm a change: the real
// KeykeeperConfirmChangeService, with upstream's dialog standing in for the
// person, who either cancels it or types their master password.
import { mock } from "jest-mock-extended";

import {
  UserVerificationDialogComponent,
  UserVerificationDialogOptions,
} from "@bitwarden/auth/angular";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { SecretVerificationRequest } from "@bitwarden/common/auth/models/request/secret-verification.request";
import { DialogService } from "@bitwarden/components";

import { KeykeeperConfirmChangeService } from "./confirm-change.service";

/** What a change carries once the person types their master password. */
export const PROOF = { masterPasswordHash: "server-side hash" };

export function confirmChangeStandIn() {
  const userVerificationService = mock<UserVerificationService>();
  userVerificationService.buildRequest.mockImplementation(
    async () => Object.assign(new SecretVerificationRequest(), PROOF) as any,
  );
  const open = jest.spyOn(UserVerificationDialogComponent, "open");
  return {
    service: new KeykeeperConfirmChangeService({} as DialogService, userVerificationService),
    open,
    /** The person closes the prompt without confirming. */
    cancels() {
      open.mockResolvedValue({ userAction: "cancel", verificationSuccess: false });
    },
    /** The person types their master password and chooses Continue. */
    confirms() {
      open.mockImplementation(async (_: DialogService, options: UserVerificationDialogOptions) => {
        const verify = options.verificationType;
        if (typeof verify !== "object") {
          throw new Error("The prompt should send the change itself");
        }
        const success = await verify.verificationFn({
          type: VerificationType.MasterPassword,
          secret: "correct horse battery staple 42",
        });
        return { userAction: "confirm", verificationSuccess: success };
      });
    },
  };
}
