import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { UserVerificationDialogComponent } from "@bitwarden/auth/angular";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { UserId } from "@bitwarden/common/types/guid";
import { DialogService } from "@bitwarden/components";
import { BiometricsService, BiometricsStatus } from "@bitwarden/key-management";

import { KeykeeperConfirmApprovalDialogComponent } from "./confirm-approval-dialog.component";

/**
 * Keykeeper: before the web vault or the extension approves a "Sign in with a
 * device" request, the person proves it's them, as our apps ask (DESIGN.md,
 * "Approving a sign-in from another device", "The web vault and the
 * extension"). `confirm` is true only once they have; only then does the
 * approval dialog send the key. Denying asks nothing.
 *
 * - The extension's biometric unlock, where it's set up for this account:
 *   the desktop app's prompt. If that's canceled or fails, the master
 *   password.
 * - The master password, checked on this device by upstream's user
 *   verification: it must open this account's user key. It's never sent.
 * - An account without a master password (one that unlocks with a key
 *   connector, which PassBundle's server doesn't offer) gets what upstream's
 *   verification offers it: a code by email.
 *
 * No PIN: our apps don't take one for this either.
 */
@Injectable({ providedIn: "root" })
export class KeykeeperApprovalConfirmation {
  constructor(
    private accountService: AccountService,
    private biometricsService: BiometricsService,
    private dialogService: DialogService,
    private userVerificationService: UserVerificationService,
  ) {}

  async confirm(): Promise<boolean> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));

    if (!(await this.userVerificationService.hasMasterPassword(userId))) {
      const result = await UserVerificationDialogComponent.open(this.dialogService, {
        title: "keykeeperConfirmApprovalTitle",
        bodyText: "keykeeperConfirmApprovalCode",
        confirmButtonOptions: { text: "keykeeperConfirmApprovalButton", type: "primary" },
      });
      return result.userAction === "confirm" && result.verificationSuccess;
    }

    if (await this.biometricsSetUp(userId)) {
      try {
        if (await this.userVerificationService.verifyUser({ type: VerificationType.Biometrics })) {
          return true;
        }
      } catch {
        // The desktop app went away, say: the master password instead.
      }
    }

    const dialog = KeykeeperConfirmApprovalDialogComponent.open(this.dialogService);
    return (await firstValueFrom(dialog.closed)) === true;
  }

  private async biometricsSetUp(userId: UserId) {
    try {
      return (
        (await this.biometricsService.getBiometricsStatusForUser(userId)) ===
        BiometricsStatus.Available
      );
    } catch {
      return false;
    }
  }
}
