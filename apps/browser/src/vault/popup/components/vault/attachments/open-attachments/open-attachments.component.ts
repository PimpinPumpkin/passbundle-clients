// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, Input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { PremiumBadgeComponent } from "@bitwarden/angular/billing/components/premium-badge";
import {
  attachingOffSentence,
  KeykeeperPlanNoticeDialogComponent,
  KeykeeperPlanSentence,
} from "@bitwarden/angular/billing/keykeeper";
import { JslibModule } from "@bitwarden/angular/jslib.module";
import {
  getOrganizationById,
  OrganizationService,
} from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions";
import { CipherId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import {
  attachingOff,
  AttachingOff,
  attachmentsWindowOpens,
} from "@bitwarden/common/vault/keykeeper/attachments-plan";
import { DialogService, ItemModule, TypographyModule } from "@bitwarden/components";
import { CipherFormContainer } from "@bitwarden/vault";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-open-attachments",
  templateUrl: "./open-attachments.component.html",
  imports: [CommonModule, ItemModule, JslibModule, TypographyModule, PremiumBadgeComponent],
})
export class OpenAttachmentsComponent implements OnInit {
  /** Cipher `id` */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input({ required: true }) cipherId: CipherId;

  /**
   * Keykeeper: why a file can't be added to this item, or null when one can
   * (DESIGN.md, "Plans and billing"). A personal item needs Premium; an
   * organization's item needs the organization to have storage.
   */
  attachingOff: AttachingOff | null = null;

  /** Keykeeper: files already on the item can be downloaded and removed on any plan. */
  hasFiles = false;

  /** Tracks the disabled status of the edit cipher form */
  parentFormDisabled: boolean;

  protected readonly attachFilesSentence = KeykeeperPlanSentence.AttachFiles;

  constructor(
    private router: Router,
    private billingAccountProfileStateService: BillingAccountProfileStateService,
    private cipherService: CipherService,
    private organizationService: OrganizationService,
    private dialogService: DialogService,
    private accountService: AccountService,
    private cipherFormContainer: CipherFormContainer,
  ) {
    this.cipherFormContainer.formStatusChange$.pipe(takeUntilDestroyed()).subscribe((status) => {
      this.parentFormDisabled = status === "disabled";
    });
  }

  async ngOnInit(): Promise<void> {
    if (!this.cipherId) {
      return;
    }

    const userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    const cipher = await firstValueFrom(this.cipherService.cipherView$(userId, this.cipherId));

    this.hasFiles = (cipher.attachments?.length ?? 0) > 0;

    if (!cipher.organizationId) {
      const hasPremium = await firstValueFrom(
        this.billingAccountProfileStateService.hasPremiumFromAnySource$(userId),
      );
      this.attachingOff = attachingOff(null, null, hasPremium);
      return;
    }

    const org = await firstValueFrom(
      this.organizationService
        .organizations$(userId)
        .pipe(getOrganizationById(cipher.organizationId)),
    );

    this.attachingOff = attachingOff(cipher.organizationId, org, false);
  }

  /**
   * Routes the user to the attachments screen. Keykeeper: it opens for any
   * item that has files, and turns adding off itself. An item with no files
   * and no right to add gets the plain sentence instead.
   */
  async openAttachments() {
    if (this.attachingOff != null && !attachmentsWindowOpens(this.hasFiles, this.attachingOff)) {
      KeykeeperPlanNoticeDialogComponent.open(this.dialogService, {
        sentence: attachingOffSentence(this.attachingOff),
      });
      return;
    }

    await this.router.navigate(["/attachments"], { queryParams: { cipherId: this.cipherId } });
  }
}
