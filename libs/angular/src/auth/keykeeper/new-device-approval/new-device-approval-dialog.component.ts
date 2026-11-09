import { CommonModule } from "@angular/common";
import { Component, Inject } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import {
  keykeeperAnswerNewDeviceRequest,
  KeykeeperLocationSource,
  KeykeeperNewDeviceRequest,
  keykeeperTypedNumber,
} from "@bitwarden/common/auth/keykeeper/new-device-check";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import {
  AsyncActionsModule,
  ButtonModule,
  CenterPositionStrategy,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
  FormFieldModule,
  LinkModule,
  ToastService,
} from "@bitwarden/components";

import { JslibModule } from "../../../jslib.module";

export type KeykeeperNewDeviceApprovalData = {
  request: KeykeeperNewDeviceRequest;
  email: string;
  source: KeykeeperLocationSource | null;
};

/** How the prompt ended: answered here, answered elsewhere or gone, or Not now. */
export type KeykeeperNewDeviceApprovalResult = "approved" | "denied" | "gone" | "later";

/**
 * Keykeeper: "Approve this sign-in?" on a device already signed in, for a
 * sign-in the new-device check holds (DESIGN.md, "New-device check"). The
 * new device shows a number; this prompt approves only when that number is
 * typed here, so a tap alone never approves. A wrong number denies it.
 */
// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-keykeeper-new-device-approval-dialog",
  templateUrl: "new-device-approval-dialog.component.html",
  imports: [
    AsyncActionsModule,
    ButtonModule,
    CommonModule,
    DialogModule,
    FormFieldModule,
    JslibModule,
    LinkModule,
    ReactiveFormsModule,
  ],
})
export class KeykeeperNewDeviceApprovalDialogComponent {
  protected form = this.formBuilder.group({ number: [""] });
  protected error: string | null = null;

  constructor(
    @Inject(DIALOG_DATA) protected data: KeykeeperNewDeviceApprovalData,
    private dialogRef: DialogRef<KeykeeperNewDeviceApprovalResult>,
    private formBuilder: FormBuilder,
    private apiService: ApiService,
    private i18nService: I18nService,
    private toastService: ToastService,
  ) {}

  static open(dialogService: DialogService, data: KeykeeperNewDeviceApprovalData) {
    return dialogService.open<KeykeeperNewDeviceApprovalResult, KeykeeperNewDeviceApprovalData>(
      KeykeeperNewDeviceApprovalDialogComponent,
      { data, positionStrategy: new CenterPositionStrategy(), disableClose: true },
    );
  }

  protected when(date: string): string {
    const at = Date.parse(date);
    return Number.isNaN(at) ? "" : new Date(at).toLocaleString();
  }

  protected approve = async () => {
    this.error = null;
    const typed = keykeeperTypedNumber(this.form.value.number ?? "");
    if (typed == null) {
      this.error = this.i18nService.t("keykeeperApproveSignInNumberNeeded");
      return;
    }
    await this.answer(typed);
  };

  protected deny = async () => {
    await this.answer(null);
  };

  protected later() {
    void this.dialogRef.close("later");
  }

  private async answer(number: string | null) {
    try {
      const r = await keykeeperAnswerNewDeviceRequest(
        this.apiService,
        this.data.request.id,
        number,
      );
      if (r.approved) {
        this.toastService.showToast({
          variant: "success",
          message: this.i18nService.t("keykeeperApproveSignInApproved"),
        });
        void this.dialogRef.close("approved");
        return;
      }
      this.toastService.showToast({
        variant: r.deniedWhy === "number" ? "error" : "info",
        message: this.i18nService.t(
          r.deniedWhy === "number"
            ? "keykeeperApproveSignInWrongNumber"
            : "keykeeperApproveSignInDenied",
        ),
      });
      void this.dialogRef.close("denied");
    } catch (e) {
      if (e instanceof ErrorResponse && e.statusCode === 404) {
        this.toastService.showToast({
          variant: "info",
          message: this.i18nService.t("keykeeperApproveSignInGone"),
        });
        void this.dialogRef.close("gone");
        return;
      }
      this.error = plainErrorMessage(e);
    }
  }
}
