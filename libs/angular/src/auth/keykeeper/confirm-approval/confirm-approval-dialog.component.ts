import { Component } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import {
  AsyncActionsModule,
  ButtonModule,
  DialogModule,
  DialogRef,
  DialogService,
  FormFieldModule,
  IconButtonModule,
} from "@bitwarden/components";

import { JslibModule } from "../../../jslib.module";

/**
 * Keykeeper: "Confirm it's you", the master password before approving a
 * "Sign in with a device" request (KeykeeperApprovalConfirmation). It's
 * checked on this device with upstream's user verification, which must open
 * the account's user key with it, and never sent. The field is emptied as
 * the check starts, so the password is held only while it runs. Closes with
 * true once it's right; a wrong one says so, and nothing is sent.
 */
// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-keykeeper-confirm-approval-dialog",
  templateUrl: "confirm-approval-dialog.component.html",
  imports: [
    AsyncActionsModule,
    ButtonModule,
    DialogModule,
    FormFieldModule,
    IconButtonModule,
    JslibModule,
    ReactiveFormsModule,
  ],
})
export class KeykeeperConfirmApprovalDialogComponent {
  protected form = this.formBuilder.group({ masterPassword: [""] });
  protected wrong = false;

  constructor(
    private dialogRef: DialogRef<boolean>,
    private formBuilder: FormBuilder,
    private userVerificationService: UserVerificationService,
  ) {}

  static open(dialogService: DialogService) {
    return dialogService.open<boolean>(KeykeeperConfirmApprovalDialogComponent);
  }

  protected confirm = async () => {
    const secret = this.form.value.masterPassword ?? "";
    this.form.reset();
    if (secret === "") {
      return;
    }
    this.wrong = false;
    let confirmed = false;
    try {
      // Throws for a wrong one.
      confirmed = await this.userVerificationService.verifyUser({
        type: VerificationType.MasterPassword,
        secret,
      });
    } catch {
      confirmed = false;
    }
    if (confirmed) {
      void this.dialogRef.close(true);
      return;
    }
    this.wrong = true;
  };

  protected cancel() {
    void this.dialogRef.close(false);
  }
}
