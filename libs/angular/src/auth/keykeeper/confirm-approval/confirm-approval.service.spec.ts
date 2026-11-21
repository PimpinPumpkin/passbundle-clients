import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { UserVerificationDialogComponent } from "@bitwarden/auth/angular";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { DialogRef, DialogService } from "@bitwarden/components";
import { BiometricsService, BiometricsStatus } from "@bitwarden/key-management";

import { KeykeeperConfirmApprovalDialogComponent } from "./confirm-approval-dialog.component";
import { KeykeeperApprovalConfirmation } from "./confirm-approval.service";

describe("KeykeeperApprovalConfirmation", () => {
  const userId = "user-id" as UserId;
  let accountService: MockProxy<AccountService>;
  let biometricsService: MockProxy<BiometricsService>;
  let dialogService: MockProxy<DialogService>;
  let userVerificationService: MockProxy<UserVerificationService>;
  let passwordDialog: jest.SpyInstance;
  let upstreamDialog: jest.SpyInstance;
  let confirmation: KeykeeperApprovalConfirmation;

  /** The master password dialog closes with this. */
  const passwordDialogCloses = (result: boolean | undefined) =>
    passwordDialog.mockReturnValue({ closed: of(result) } as unknown as DialogRef<boolean>);

  beforeEach(() => {
    accountService = mock<AccountService>();
    accountService.activeAccount$ = of({
      id: userId,
      ...mockAccountInfoWith({ email: "ana@example.test", name: null }),
    });
    biometricsService = mock<BiometricsService>();
    biometricsService.getBiometricsStatusForUser.mockResolvedValue(
      BiometricsStatus.PlatformUnsupported,
    );
    dialogService = mock<DialogService>();
    userVerificationService = mock<UserVerificationService>();
    userVerificationService.hasMasterPassword.mockResolvedValue(true);
    passwordDialog = jest.spyOn(KeykeeperConfirmApprovalDialogComponent, "open");
    passwordDialogCloses(true);
    upstreamDialog = jest.spyOn(UserVerificationDialogComponent, "open");
    confirmation = new KeykeeperApprovalConfirmation(
      accountService,
      biometricsService,
      dialogService,
      userVerificationService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("asks for the master password where there's no biometric unlock (the web vault)", async () => {
    expect(await confirmation.confirm()).toBe(true);

    expect(biometricsService.getBiometricsStatusForUser).toHaveBeenCalledWith(userId);
    expect(passwordDialog).toHaveBeenCalledWith(dialogService);
    expect(userVerificationService.verifyUser).not.toHaveBeenCalled();
    expect(upstreamDialog).not.toHaveBeenCalled();
  });

  it("is false when the master password dialog is canceled or closed", async () => {
    passwordDialogCloses(false);
    expect(await confirmation.confirm()).toBe(false);
    passwordDialogCloses(undefined);
    expect(await confirmation.confirm()).toBe(false);
  });

  it("uses the extension's biometric unlock where it's set up for this account", async () => {
    biometricsService.getBiometricsStatusForUser.mockResolvedValue(BiometricsStatus.Available);
    userVerificationService.verifyUser.mockResolvedValue(true);

    expect(await confirmation.confirm()).toBe(true);

    expect(userVerificationService.verifyUser).toHaveBeenCalledWith({
      type: VerificationType.Biometrics,
    });
    expect(passwordDialog).not.toHaveBeenCalled();
  });

  it("falls back to the master password when the biometric prompt is canceled or fails", async () => {
    biometricsService.getBiometricsStatusForUser.mockResolvedValue(BiometricsStatus.Available);
    userVerificationService.verifyUser.mockResolvedValueOnce(false);
    passwordDialogCloses(false);
    expect(await confirmation.confirm()).toBe(false);
    expect(passwordDialog).toHaveBeenCalledTimes(1);

    userVerificationService.verifyUser.mockRejectedValueOnce(new Error("desktop disconnected"));
    passwordDialogCloses(true);
    expect(await confirmation.confirm()).toBe(true);
    expect(passwordDialog).toHaveBeenCalledTimes(2);
  });

  it("doesn't use biometrics that aren't set up for this account", async () => {
    for (const status of [
      BiometricsStatus.NotEnabledLocally,
      BiometricsStatus.NotEnabledInConnectedDesktopApp,
      BiometricsStatus.DesktopDisconnected,
      BiometricsStatus.UnlockNeeded,
    ]) {
      biometricsService.getBiometricsStatusForUser.mockResolvedValue(status);
      expect(await confirmation.confirm()).toBe(true);
    }
    expect(userVerificationService.verifyUser).not.toHaveBeenCalled();
    expect(passwordDialog).toHaveBeenCalledTimes(4);
  });

  it("gives an account without a master password upstream's verification: a code by email", async () => {
    userVerificationService.hasMasterPassword.mockResolvedValue(false);
    upstreamDialog.mockResolvedValue({ userAction: "confirm", verificationSuccess: true });

    expect(await confirmation.confirm()).toBe(true);

    expect(upstreamDialog).toHaveBeenCalledWith(
      dialogService,
      expect.objectContaining({ title: "keykeeperConfirmApprovalTitle" }),
    );
    // The default verification: a code by email for such an account, never
    // client-side only (which would offer a PIN).
    expect(upstreamDialog.mock.calls[0][1].verificationType).toBeUndefined();
    expect(passwordDialog).not.toHaveBeenCalled();
    expect(biometricsService.getBiometricsStatusForUser).not.toHaveBeenCalled();

    for (const result of [
      { userAction: "confirm", verificationSuccess: false },
      { userAction: "cancel", verificationSuccess: false },
    ]) {
      upstreamDialog.mockResolvedValue(result);
      expect(await confirmation.confirm()).toBe(false);
    }
  });
});
