import { mock, MockProxy } from "jest-mock-extended";

import {
  UserVerificationDialogComponent,
  UserVerificationDialogOptions,
  UserVerificationDialogResult,
} from "@bitwarden/auth/angular";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { SecretVerificationRequest } from "@bitwarden/common/auth/models/request/secret-verification.request";
import { VerificationWithSecret } from "@bitwarden/common/auth/types/verification";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { DialogService } from "@bitwarden/components";

import { isWrongSecret, KeykeeperConfirmChangeService } from "./confirm-change.service";

jest.mock("@bitwarden/auth/angular", () => ({
  UserVerificationDialogComponent: { open: jest.fn() },
}));

const open = UserVerificationDialogComponent.open as jest.Mock;

/** The server's error answer, as Vaultwarden's err! sends it. */
const serverError = (message: string, status = 400) =>
  new ErrorResponse({ message, validationErrors: { "": [message] } }, status);

const password: VerificationWithSecret = {
  type: VerificationType.MasterPassword,
  secret: "correct horse battery staple 42",
};
const code: VerificationWithSecret = { type: VerificationType.OTP, secret: "123456" };

/**
 * Stands in for upstream's dialog: submits each secret in turn, as the
 * person would, until the dialog closes the way the real one does. A
 * verificationFn that throws keeps it open for the next secret.
 */
function submits(...secrets: VerificationWithSecret[]) {
  open.mockImplementation(async (_: DialogService, options: UserVerificationDialogOptions) => {
    const verify = options.verificationType;
    if (typeof verify !== "object") {
      throw new Error("expected custom verification");
    }
    for (const secret of secrets) {
      try {
        const success = await verify.verificationFn(secret);
        return { userAction: "confirm", verificationSuccess: success };
      } catch {
        // Marked wrong; the person tries again.
      }
    }
    return { userAction: "cancel", verificationSuccess: false };
  });
}

describe("KeykeeperConfirmChangeService", () => {
  // A plain object: the dialog is upstream's, opened through this.
  const dialogService = {} as DialogService;
  let userVerificationService: MockProxy<UserVerificationService>;
  let service: KeykeeperConfirmChangeService;

  beforeEach(() => {
    open.mockReset();
    userVerificationService = mock<UserVerificationService>();
    userVerificationService.buildRequest.mockImplementation(async (verification) => {
      const request = new SecretVerificationRequest();
      if (verification.type === VerificationType.OTP) {
        request.otp = verification.secret;
      } else {
        request.masterPasswordHash = `hash of ${(verification as VerificationWithSecret).secret}`;
      }
      return request as any;
    });
    service = new KeykeeperConfirmChangeService(dialogService, userVerificationService);
  });

  it("sends nothing when the person cancels", async () => {
    open.mockResolvedValue({
      userAction: "cancel",
      verificationSuccess: false,
    } satisfies UserVerificationDialogResult);
    const change = jest.fn();

    await expect(service.send("keykeeperConfirmSsoSettings", change)).resolves.toBeUndefined();
    expect(change).not.toHaveBeenCalled();
    expect(userVerificationService.buildRequest).not.toHaveBeenCalled();
  });

  it("asks with upstream's prompt, the change's text, and Continue", async () => {
    open.mockResolvedValue({ userAction: "cancel", verificationSuccess: false });
    await service.send("keykeeperConfirmProvisioningToken", jest.fn());
    expect(open).toHaveBeenCalledWith(
      dialogService,
      expect.objectContaining({
        bodyText: "keykeeperConfirmProvisioningToken",
        confirmButtonOptions: { text: "continue", type: "primary" },
        verificationType: expect.objectContaining({ type: "custom" }),
      }),
    );
  });

  it("sends the change with the master password's hash, and answers with the server's answer", async () => {
    submits(password);
    const change = jest.fn().mockResolvedValue({ id: "made" });

    await expect(service.send("keykeeperConfirmScriptToken", change)).resolves.toEqual({
      id: "made",
    });
    expect(userVerificationService.buildRequest).toHaveBeenCalledWith(password);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith({
      masterPasswordHash: "hash of correct horse battery staple 42",
    });
  });

  it("sends the code instead for an account without a master password", async () => {
    submits(code);
    const change = jest.fn().mockResolvedValue({ id: "made" });

    await service.send("keykeeperConfirmEventDestination", change);
    expect(change).toHaveBeenCalledWith({ otp: "123456" });
  });

  it("keeps the prompt open after a wrong password, and sends again with the right one", async () => {
    const wrong: VerificationWithSecret = { type: VerificationType.MasterPassword, secret: "nope" };
    submits(wrong, password);
    const change = jest
      .fn()
      .mockRejectedValueOnce(serverError("Invalid password"))
      .mockResolvedValueOnce({ id: "made" });

    await expect(service.send("keykeeperConfirmSsoSettings", change)).resolves.toEqual({
      id: "made",
    });
    expect(change).toHaveBeenCalledTimes(2);
    expect(change.mock.calls[0][0]).toEqual({ masterPasswordHash: "hash of nope" });
    expect(change.mock.calls[1][0]).toEqual({
      masterPasswordHash: "hash of correct horse battery staple 42",
    });
  });

  it("sends nothing more when the person gives up after a wrong password", async () => {
    const wrong: VerificationWithSecret = { type: VerificationType.MasterPassword, secret: "nope" };
    submits(wrong);
    const change = jest.fn().mockRejectedValue(serverError("Invalid password"));

    await expect(service.send("keykeeperConfirmSsoSettings", change)).resolves.toBeUndefined();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("closes the prompt and throws when the server refuses the change itself", async () => {
    submits(password, password);
    const refusal = serverError(
      "The SSO identifier is 3 to 40 lowercase letters, digits, and hyphens, such as acme-dental.",
    );
    const change = jest.fn().mockRejectedValue(refusal);

    await expect(service.send("keykeeperConfirmSsoSettings", change)).rejects.toBe(refusal);
    // Closed after the first: the person sees why, not "wrong password".
    expect(change).toHaveBeenCalledTimes(1);
  });
});

describe("isWrongSecret", () => {
  it.each([
    "Invalid password",
    "Token is invalid",
    "Token has expired",
    "Protected action token not found, try sending the code again or restart the process",
  ])("is the server's answer to a wrong password or code: %s", (message) => {
    expect(isWrongSecret(serverError(message))).toBe(true);
  });

  it("isn't any other refusal", () => {
    expect(isWrongSecret(serverError("Confirm this change with your master password"))).toBe(false);
    expect(isWrongSecret(serverError("Only webhooks have a signing secret"))).toBe(false);
    expect(isWrongSecret(serverError("Invalid password", 500))).toBe(false);
    expect(isWrongSecret(new Error("Invalid password"))).toBe(false);
  });
});
