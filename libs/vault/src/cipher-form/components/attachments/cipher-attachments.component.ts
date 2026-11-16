// FIXME(https://bitwarden.atlassian.net/browse/CL-1062): `OnPush` components should not use mutable properties
/* eslint-disable @bitwarden/components/enforce-readonly-angular-properties */
import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { firstValueFrom } from "rxjs";

import {
  attachingOffSentence,
  KeykeeperPlanNoticeComponent,
} from "@bitwarden/angular/billing/keykeeper";
import { JslibModule } from "@bitwarden/angular/jslib.module";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { attachingOff, AttachingOff } from "@bitwarden/common/vault/keykeeper/attachments-plan";
import { CipherData } from "@bitwarden/common/vault/models/data/cipher.data";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { AttachmentView } from "@bitwarden/common/vault/models/view/attachment.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  AsyncActionsModule,
  BitSubmitDirective,
  ButtonComponent,
  ButtonModule,
  CardComponent,
  FileUploadComponent,
  FormFieldModule,
  ItemModule,
  ProgressBarComponent,
  ToastService,
} from "@bitwarden/components";

import { DownloadAttachmentComponent } from "../../../components/download-attachment/download-attachment.component";
import { TruncatedFilenameComponent } from "../../../components/truncated-filename";

import { DeleteAttachmentComponent } from "./delete-attachment/delete-attachment.component";

type CipherAttachmentForm = FormGroup<{
  file: FormControl<File | null>;
}>;

@Component({
  selector: "app-cipher-attachments",
  templateUrl: "./cipher-attachments.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncActionsModule,
    ButtonModule,
    CardComponent,
    CommonModule,
    DeleteAttachmentComponent,
    DownloadAttachmentComponent,
    FileUploadComponent,
    FormFieldModule,
    ItemModule,
    JslibModule,
    KeykeeperPlanNoticeComponent,
    ProgressBarComponent,
    ReactiveFormsModule,
    TruncatedFilenameComponent,
  ],
})
export class CipherAttachmentsComponent {
  /** `id` associated with the form element */
  static attachmentFormID = "attachmentForm";

  /** Reference to the BitSubmitDirective */
  readonly bitSubmit = viewChild(BitSubmitDirective);

  /** The `id` of the cipher in context */
  readonly cipherId = input.required<CipherId>();

  /** The organization ID if this cipher belongs to an organization */
  readonly organizationId = input<OrganizationId>();

  /** Denotes if the action is occurring from within the admin console */
  readonly admin = input<boolean>(false);

  /** An optional submit button, whose loading/disabled state will be tied to the form state. */
  readonly submitBtn = input<ButtonComponent>();

  /** Emits when a file upload is started */
  readonly onUploadStarted = output<void>();

  /** Emits after a file has been successfully uploaded */
  readonly onUploadSuccess = output<void>();

  /** Emits when a file upload fails */
  readonly onUploadFailed = output<void>();

  /** Emits after a file has been successfully removed */
  readonly onRemoveSuccess = output<void>();

  readonly onCloseButtonPress = output<void>();

  /**
   * Keykeeper: emits once when the plan doesn't let files be added to this
   * item, so the window around this list can turn its Upload button into
   * Close. The files already here can still be downloaded and removed.
   */
  readonly onAddingOff = output<AttachingOff>();

  protected readonly organization = signal<Organization | null>(null);
  protected readonly cipher = signal<CipherView | null>(null);
  protected readonly uploadProgress = signal<number | null>(null);

  /**
   * Keykeeper: why files can't be added to this item, or null when they can
   * (DESIGN.md, "Plans and billing"): a personal item needs Premium, and an
   * organization's item needs the organization's storage, which is 0 once its
   * plan has ended.
   */
  protected readonly addingOff = signal<AttachingOff | null>(null);

  /** Keykeeper: the plain sentence shown where the file picker would be. */
  protected readonly addingOffSentence = computed(() => {
    const off = this.addingOff();
    return off == null ? null : attachingOffSentence(off);
  });

  attachmentForm: CipherAttachmentForm = this.formBuilder.group({
    file: new FormControl<File | null>(null, {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  private cipherDomain: Cipher | null = null;
  private activeUserId: UserId | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private readonly billingAccountProfileStateService = inject(BillingAccountProfileStateService);

  constructor(
    private cipherService: CipherService,
    private i18nService: I18nService,
    private formBuilder: FormBuilder,
    private logService: LogService,
    private toastService: ToastService,
    private accountService: AccountService,
    private apiService: ApiService,
    private organizationService: OrganizationService,
  ) {
    this.attachmentForm.statusChanges.pipe(takeUntilDestroyed()).subscribe((status) => {
      const btn = this.submitBtn();
      if (!btn) {
        return;
      }

      btn.disabled.set(status !== "VALID");
    });

    // Initialize data when cipherId input is available
    effect(async () => {
      const cipherId = this.cipherId();
      if (!cipherId) {
        return;
      }

      this.activeUserId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      // Get the organization to check admin permissions
      this.organization.set(await this.getOrganization());
      this.cipherDomain = await this.getCipher(cipherId);

      if (this.cipherDomain && this.activeUserId) {
        this.cipher.set(await this.cipherService.decrypt(this.cipherDomain, this.activeUserId));
      }

      // Keykeeper: adding is the plan's to allow; downloading and removing aren't.
      const off = await this.planTurnsAddingOff();
      this.addingOff.set(off);
      if (off != null) {
        this.onAddingOff.emit(off);
      }

      // Update the initial state of the submit button
      const btn = this.submitBtn();
      if (btn) {
        btn.disabled.set(
          !this.attachmentForm.valid && (this.cipher()?.edit ?? true) && off == null,
        );
      }
    });

    // Sync bitSubmit loading/disabled state with submitBtn
    effect(() => {
      const bitSubmit = this.bitSubmit();
      const btn = this.submitBtn();
      if (!bitSubmit || !btn) {
        return;
      }

      bitSubmit.loading$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((loading) => {
        btn.loading.set(loading);
      });

      bitSubmit.disabled$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((disabled) => {
        btn.disabled.set(disabled);
      });
    });
  }

  /** Reference the `id` via the static property */
  get attachmentFormId(): string {
    return CipherAttachmentsComponent.attachmentFormID;
  }

  /** Save the attachments to the cipher */
  submit = async () => {
    //user can't edit cipher and will close the bit-dialog
    if (!(this.cipher()?.edit ?? false)) {
      this.onCloseButtonPress.emit();
      return;
    }

    // Keykeeper: nothing can be added on this plan, so the button only closes.
    if (this.addingOff() != null) {
      this.onCloseButtonPress.emit();
      return;
    }

    this.onUploadStarted.emit();

    const file = this.attachmentForm.value.file;
    if (file == null) {
      this.toastService.showToast({
        variant: "error",
        title: this.i18nService.t("errorOccurred"),
        message: this.i18nService.t("selectFile"),
      });
      this.onUploadFailed.emit();
      return;
    }

    if (file.size > 524288000) {
      // 500 MB
      this.toastService.showToast({
        variant: "error",
        title: this.i18nService.t("errorOccurred"),
        message: this.i18nService.t("maxFileSize"),
      });
      this.onUploadFailed.emit();
      return;
    }

    if (!this.cipherDomain || !this.activeUserId) {
      return;
    }

    if ((this.cipher()?.attachments ?? []).some((a) => (a.fileName ?? "") === file.name)) {
      // File has the same name as an existing attachment
      this.toastService.showToast({
        variant: "error",
        title: this.i18nService.t("errorOccurred"),
        message: this.i18nService.t("duplicateAttachmentNameError"),
      });
      this.onUploadFailed.emit();
      return;
    }

    try {
      this.uploadProgress.set(0);
      this.cipherDomain = await this.cipherService.saveAttachmentWithServer(
        this.cipherDomain,
        file,
        this.activeUserId,
        this.admin(),
        {
          onProgress: (p) => this.uploadProgress.set(p),
        },
      );

      // re-decrypt the cipher to update the attachments
      this.cipher.set(await this.cipherService.decrypt(this.cipherDomain, this.activeUserId));

      this.attachmentForm.controls.file.setValue(null);

      this.toastService.showToast({
        variant: "success",
        message: this.i18nService.t("attachmentSaved"),
      });

      this.onUploadSuccess.emit();
    } catch (e) {
      this.logService.error(e);

      // Extract error message from server response, fallback to generic message
      let errorMessage = this.i18nService.t("unexpectedError");
      if (typeof e === "string") {
        errorMessage = e;
      } else if (e instanceof Error && e?.message) {
        errorMessage = e.message;
      }

      this.toastService.showToast({
        variant: "error",
        message: errorMessage,
      });
      this.onUploadFailed.emit();
    } finally {
      this.uploadProgress.set(null);
    }
  };

  /** Removes the attachment from the cipher */
  removeAttachment(attachment: AttachmentView) {
    const currentCipher = this.cipher();
    if (!currentCipher?.attachments) {
      return;
    }

    const index = currentCipher.attachments.indexOf(attachment);

    if (index > -1) {
      currentCipher.attachments.splice(index, 1);
      // Trigger signal update by creating a new reference
      this.cipher.set(
        Object.assign(Object.create(Object.getPrototypeOf(currentCipher)), currentCipher),
      );
    }

    this.onRemoveSuccess.emit();
  }

  /**
   * Gets a cipher using the appropriate method based on user permissions.
   * If the user doesn't have direct access, but has organization admin access,
   * it will retrieve the cipher using the admin endpoint.
   */
  private async getCipher(id: CipherId): Promise<Cipher | null> {
    if (id == null || !this.activeUserId) {
      return null;
    }

    // When in admin context, always fetch from server to get fresh data.
    // Admin uploads skip local state upsert, so local state may be stale.
    if (this.admin()) {
      const cipherResponse = await this.apiService.getCipherAdmin(id);
      // Admin API response doesn't include `edit`, but admin users always have edit access
      cipherResponse.edit = true;
      const cipherData = new CipherData(cipherResponse);
      return new Cipher(cipherData);
    }

    // First try to get the cipher directly with user permissions
    const localCipher = await this.cipherService.get(id, this.activeUserId);

    // If we got the cipher or there's no organization context, return the result
    if (localCipher != null || !this.organizationId()) {
      return localCipher;
    }

    return null;
  }

  /**
   * Gets the organization for the given organization ID
   */
  private async getOrganization(): Promise<Organization | null> {
    return this.findOrganization(this.organizationId());
  }

  private async findOrganization(orgId: string | null | undefined): Promise<Organization | null> {
    if (!orgId || !this.activeUserId) {
      return null;
    }

    const organizations = await firstValueFrom(
      this.organizationService.organizations$(this.activeUserId),
    );

    return organizations.find((o) => o.id === orgId) || null;
  }

  /**
   * Keykeeper: whether the plan turns adding off for this item. The item's own
   * organization decides, since the extension's page passes no organization.
   */
  private async planTurnsAddingOff(): Promise<AttachingOff | null> {
    const cipher = this.cipher();
    if (cipher == null || !cipher.edit || !this.activeUserId) {
      return null;
    }

    const organizationId = cipher.organizationId ?? this.organizationId();
    const organization = this.organization() ?? (await this.findOrganization(organizationId));
    const hasPremium = organizationId
      ? false
      : await firstValueFrom(
          this.billingAccountProfileStateService.hasPremiumFromAnySource$(this.activeUserId),
        );

    return attachingOff(organizationId, organization, hasPremium);
  }

  protected fixOldAttachment = (attachment: AttachmentView) => {
    return async () => {
      const cipher = this.cipher();
      const userId = this.activeUserId;

      if (!attachment.id || !userId || !cipher) {
        this.toastService.showToast({
          variant: "error",
          message: this.i18nService.t("errorOccurred"),
        });
        return;
      }

      try {
        const updatedCipher = await this.cipherService.upgradeOldCipherAttachments(
          cipher,
          userId,
          attachment.id,
        );

        this.cipher.set(updatedCipher);
        this.toastService.showToast({
          variant: "success",
          message: this.i18nService.t("attachmentUpdated"),
        });
        this.onUploadSuccess.emit();
      } catch {
        this.toastService.showToast({
          variant: "error",
          message: this.i18nService.t("errorOccurred"),
        });
      }
    };
  };
}
