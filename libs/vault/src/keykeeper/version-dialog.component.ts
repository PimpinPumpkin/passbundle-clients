import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  signal,
} from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  AsyncActionsModule,
  BadgeComponent,
  BitIconButtonComponent,
  ButtonModule,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
  LinkModule,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { restoreConfirmation, VersionRow, versionRows, versionTime } from "./item-versions";

export type VersionDialogData = {
  /** The version, decrypted. */
  version: CipherView;
  /** The item as it is now. */
  current: CipherView;
  /** When the version was saved. */
  revisionDate: Date;
  /** "Saved by …", when known. */
  savedBy: string | null;
  /**
   * Saves the version as the item's newest; absent when the person can't edit
   * the item or can't see its passwords.
   */
  restore?: () => Promise<CipherView>;
  /** Deletes the version; absent when the person can't delete the item. */
  delete?: () => Promise<void>;
};

/** The item as saved when a version was restored, or "deleted" when it was deleted. */
export type VersionDialogResult = CipherView | "deleted" | undefined;

const MASK = "••••••••";

/**
 * Keykeeper: one earlier version of an item next to the item now, field by
 * field, with what changed marked; "Restore this version" for people who can
 * edit the item and see its passwords, and "Delete this version" for people
 * who can delete it. Hidden values (passwords and the like) stay masked until
 * shown (DESIGN.md, "Item history").
 */
@Component({
  selector: "app-keykeeper-version-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncActionsModule,
    BadgeComponent,
    BitIconButtonComponent,
    ButtonModule,
    DialogModule,
    I18nPipe,
    LinkModule,
    TypographyModule,
  ],
  template: `
    <bit-dialog dialogSize="large">
      <span bitDialogTitle>{{ "keykeeperVersionFrom" | i18n: when }}</span>
      <div bitDialogContent>
        @if (data.savedBy) {
          <p bitTypography="body2" class="tw-text-muted">{{ data.savedBy }}</p>
        }
        @if (unchanged()) {
          <p bitTypography="body2" data-testid="keykeeper-version-same">
            {{ "keykeeperVersionSameAsNow" | i18n }}
          </p>
        }
        <table
          class="tw-w-full tw-table-fixed tw-border-collapse"
          data-testid="keykeeper-version-fields"
        >
          <thead>
            <tr class="tw-border-0 tw-border-b tw-border-solid tw-border-secondary-300">
              <th scope="col" class="tw-w-1/4 tw-py-2 tw-pr-3 tw-text-left" bitTypography="body2">
                <span class="tw-sr-only">{{ "keykeeperField" | i18n }}</span>
              </th>
              <th scope="col" class="tw-py-2 tw-pr-3 tw-text-left" bitTypography="body2">
                {{ "keykeeperThisVersion" | i18n }}
              </th>
              <th scope="col" class="tw-py-2 tw-text-left" bitTypography="body2">
                {{ "keykeeperNow" | i18n }}
              </th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr
                class="tw-border-0 tw-border-b tw-border-solid tw-border-secondary-100 tw-align-top"
                [class.tw-bg-warning-100]="row.changed"
                [attr.data-changed]="row.changed"
              >
                <th
                  scope="row"
                  class="tw-py-2 tw-pl-1 tw-pr-3 tw-text-left tw-font-normal"
                  bitTypography="body2"
                >
                  <div class="tw-break-words tw-font-semibold">{{ row.label }}</div>
                  @if (row.changed) {
                    <span bitBadge variant="warning" class="tw-mt-1">{{
                      "keykeeperChanged" | i18n
                    }}</span>
                  }
                </th>
                <td
                  class="tw-py-2 tw-pr-3 tw-break-words tw-whitespace-pre-wrap"
                  bitTypography="body2"
                >
                  {{ shown(row, row.version) }}
                </td>
                <td class="tw-py-2 tw-break-words tw-whitespace-pre-wrap" bitTypography="body2">
                  {{ shown(row, row.current) }}
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (hasSecrets() && canSeeSecrets) {
          <button type="button" bitLink class="tw-mt-3" (click)="reveal.set(!reveal())">
            {{ (reveal() ? "keykeeperHideHiddenValues" : "keykeeperShowHiddenValues") | i18n }}
          </button>
        }
      </div>
      <ng-container bitDialogFooter>
        @if (data.restore && !unchanged()) {
          <button bitButton buttonType="primary" type="button" [bitAction]="restore">
            {{ "keykeeperRestoreVersion" | i18n }}
          </button>
        }
        <button bitButton buttonType="secondary" type="button" bitDialogClose>
          {{ "close" | i18n }}
        </button>
        @if (data.delete) {
          <button
            type="button"
            class="tw-ml-auto"
            bitIconButton="bwi-trash"
            buttonType="dangerGhost"
            [label]="'keykeeperDeleteVersion' | i18n"
            [bitAction]="deleteVersion"
          ></button>
        }
      </ng-container>
    </bit-dialog>
  `,
})
export class KeykeeperVersionDialogComponent {
  protected readonly data = inject<VersionDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject<DialogRef<VersionDialogResult>>(DialogRef);
  private readonly dialogService = inject(DialogService);
  private readonly i18nService = inject(I18nService);
  private readonly toastService = inject(ToastService);

  /** When the version was saved, as the item view shows dates. */
  protected readonly when = versionTime(this.data.revisionDate, inject(LOCALE_ID));

  /** People who can't see an item's passwords never see them in its versions either. */
  protected readonly canSeeSecrets = maySeeSecrets(this.data.current);
  protected readonly reveal = signal(false);

  protected readonly rows = computed(() =>
    versionRows(this.data.version, this.data.current, (key, ...args) =>
      this.i18nService.t(key, ...args.map(String)),
    ),
  );
  protected readonly unchanged = computed(() => this.rows().every((row) => !row.changed));
  protected readonly hasSecrets = computed(() => this.rows().some((row) => row.secret));

  protected shown(row: VersionRow, value: string): string {
    if (!row.secret || !value || (this.canSeeSecrets && this.reveal())) {
      return value;
    }
    return MASK;
  }

  protected readonly restore = async () => {
    // Keykeeper: it says first which passkeys restoring would take away.
    const confirmed = await this.dialogService.openSimpleDialog(
      restoreConfirmation(this.data.version, this.data.current, this.when),
    );
    if (!confirmed || !this.data.restore) {
      return;
    }
    const saved = await this.data.restore();
    this.toastService.showToast({
      variant: "success",
      message: this.i18nService.t("keykeeperVersionRestored"),
    });
    await this.dialogRef.close(saved);
  };

  protected readonly deleteVersion = async () => {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "keykeeperDeleteVersionTitle" },
      content: { key: "keykeeperDeleteVersionDesc", placeholders: [this.when] },
      acceptButtonText: { key: "delete" },
      type: "danger",
    });
    if (!confirmed || !this.data.delete) {
      return;
    }
    await this.data.delete();
    this.toastService.showToast({
      variant: "success",
      message: this.i18nService.t("keykeeperVersionDeleted"),
    });
    await this.dialogRef.close("deleted");
  };

  static open(dialogService: DialogService, data: VersionDialogData) {
    return dialogService.open<VersionDialogResult, VersionDialogData>(
      KeykeeperVersionDialogComponent,
      {
        data,
      },
    );
  }
}
