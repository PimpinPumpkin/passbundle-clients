import { ChangeDetectionStrategy, Component, Inject, signal } from "@angular/core";
import { Router } from "@angular/router";

import { IconComponent } from "@bitwarden/angular/vault/components/icon.component";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DIALOG_DATA, DialogRef, DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { passwordListText, SeenPassword } from "./access-review";

export type SeenPasswordsDialogData = {
  /** Who was removed or revoked. */
  name: string;
  organizationId: string;
  /** Whether "Open" goes to the admin console's vault, or the person's own. */
  openInAdminConsole: boolean;
  /** They saw every item, so the list is every login. */
  everyItem: boolean;
  passwords: SeenPassword[];
  /** The decrypted items, for their icons. */
  items: Map<string, CipherView>;
};

/**
 * Keykeeper: right after someone is removed or revoked, the logins whose
 * passwords they could see, to change. Names and shared folders only, never a
 * secret, and nothing is kept: the list is shown once. "Open" opens an item
 * over this dialog, so the list stays while each password is changed. See
 * DESIGN.md, "Access and offboarding".
 */
@Component({
  selector: "app-keykeeper-seen-passwords-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, IconComponent],
  template: `
    <bit-dialog
      dialogSize="large"
      [title]="'keykeeperSeenPasswordsTitle' | i18n: data.name"
      data-testid="seen-passwords"
    >
      <div bitDialogContent>
        <p>
          {{
            (data.everyItem ? "keykeeperSeenPasswordsEveryItem" : "keykeeperSeenPasswordsIntro")
              | i18n: data.name
          }}
        </p>
        @if (!showing()) {
          <button type="button" bitButton buttonType="secondary" (click)="showing.set(true)">
            {{
              data.passwords.length === 1
                ? ("keykeeperSeenPasswordsShowOne" | i18n)
                : ("keykeeperSeenPasswordsShowAll" | i18n: data.passwords.length.toString())
            }}
          </button>
        } @else {
          <bit-table>
            <ng-container header>
              <tr>
                <th bitCell class="tw-w-12"></th>
                <th bitCell>{{ "name" | i18n }}</th>
                <th bitCell>{{ "keykeeperSeenPasswordsFolders" | i18n }}</th>
                <th bitCell class="tw-w-20"></th>
              </tr>
            </ng-container>
            <ng-template body>
              @for (seen of data.passwords; track seen.item.id) {
                <tr bitRow data-testid="seen-password" [attr.data-name]="seen.item.name">
                  <td bitCell>
                    @if (data.items.get(seen.item.id); as cipher) {
                      <app-vault-icon [cipher]="cipher"></app-vault-icon>
                    }
                  </td>
                  <td bitCell class="tw-break-all">{{ seen.item.name }}</td>
                  <td bitCell data-testid="seen-password-folders">{{ folders(seen) }}</td>
                  <td bitCell class="tw-text-right">
                    <button
                      type="button"
                      bitLink
                      [attr.aria-label]="'keykeeperSeenPasswordsOpen' | i18n: seen.item.name"
                      (click)="open(seen)"
                    >
                      {{ "open" | i18n }}
                    </button>
                  </td>
                </tr>
              }
            </ng-template>
          </bit-table>
        }
        <p class="tw-mt-4 tw-text-sm tw-text-muted">
          {{ "keykeeperSeenPasswordsOtherItems" | i18n }}
        </p>
        <p class="tw-mb-0 tw-text-sm">
          {{ "keykeeperSeenPasswordsNotAgain" | i18n }}
          <a bitLink href="#" appStopClick (click)="openAccessPage()">{{
            "keykeeperSeenPasswordsAccessLink" | i18n
          }}</a>
        </p>
      </div>
      <ng-container bitDialogFooter>
        <button type="button" bitButton buttonType="primary" (click)="copy()">
          {{ "keykeeperSeenPasswordsCopy" | i18n }}
        </button>
        <button type="button" bitButton buttonType="secondary" (click)="done()">
          {{ "done" | i18n }}
        </button>
      </ng-container>
    </bit-dialog>
  `,
})
export class KeykeeperSeenPasswordsDialogComponent {
  /** For someone who saw every item, the list waits for a click. */
  protected readonly showing = signal(!this.data.everyItem);

  constructor(
    @Inject(DIALOG_DATA) protected readonly data: SeenPasswordsDialogData,
    private readonly dialogRef: DialogRef,
    private readonly router: Router,
    private readonly i18nService: I18nService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly toastService: ToastService,
  ) {}

  static open(dialogService: DialogService, data: SeenPasswordsDialogData) {
    // The list stays open while the page behind it opens each item, and
    // Escape or a click outside it doesn't close it by accident: only Done.
    return dialogService.open(KeykeeperSeenPasswordsDialogComponent, {
      data,
      closeOnNavigation: false,
      disableClose: true,
    });
  }

  protected folders(seen: SeenPassword): string {
    return seen.folders.length > 0
      ? seen.folders.map((f) => f.name).join(", ")
      : this.i18nService.t("keykeeperSeenPasswordsNoFolder");
  }

  /** Opens the item, in the admin console's vault where the viewer has it. */
  protected async open(seen: SeenPassword) {
    const queryParams = { itemId: seen.item.id, action: "view" };
    await this.router.navigate(
      this.data.openInAdminConsole
        ? ["/organizations", this.data.organizationId, "vault"]
        : ["/vault"],
      { queryParams },
    );
  }

  protected async done() {
    await this.dialogRef.close();
  }

  protected async openAccessPage() {
    await this.dialogRef.close();
    await this.router.navigate(["/organizations", this.data.organizationId, "access"]);
  }

  protected copy() {
    const text = passwordListText(this.data.passwords, {
      name: this.i18nService.t("name"),
      folders: this.i18nService.t("keykeeperSeenPasswordsFolders"),
      noFolder: this.i18nService.t("keykeeperSeenPasswordsNoFolder"),
    });
    this.platformUtilsService.copyToClipboard(text);
    this.toastService.showToast({
      variant: "success",
      message: this.i18nService.t("keykeeperSeenPasswordsCopied"),
    });
  }
}
