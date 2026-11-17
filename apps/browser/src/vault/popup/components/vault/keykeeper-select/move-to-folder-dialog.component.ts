import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { switchMap, tap } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import {
  AsyncActionsModule,
  ButtonModule,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
  FormFieldModule,
  SelectModule,
} from "@bitwarden/components";

/** How many items are being moved, for the dialog's title. */
export type MoveToFolderParams = { count: number };

/** The folder picked; `null` takes the items out of their folders. */
export type MoveToFolderChoice = { folderId: string | null };

/**
 * Keykeeper: the folder for the items selected in the popup (DESIGN.md,
 * "Selecting several items"). It only asks; the selection's service moves
 * them, through the same request the web vault's Add to folder makes.
 */
@Component({
  selector: "app-keykeeper-move-to-folder-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    JslibModule,
    AsyncActionsModule,
    ButtonModule,
    DialogModule,
    FormFieldModule,
    SelectModule,
  ],
  template: `
    <form [formGroup]="form" [bitSubmit]="submit" bit-dialog dialogSize="small">
      <span bitDialogTitle>{{ title }}</span>
      <div bitDialogContent>
        <bit-form-field disableMargin>
          <bit-label>{{ "folder" | i18n }}</bit-label>
          <bit-select formControlName="folderId" data-testid="keykeeper-move-folder">
            @for (folder of folders$ | async; track folder.id) {
              <bit-option [value]="folder.id ?? null" [label]="folder.name"></bit-option>
            }
          </bit-select>
        </bit-form-field>
      </div>
      <ng-container bitDialogFooter>
        <button bitButton bitFormButton type="submit" buttonType="primary">
          {{ "move" | i18n }}
        </button>
        <button bitButton type="button" buttonType="secondary" (click)="cancel()">
          {{ "cancel" | i18n }}
        </button>
      </ng-container>
    </form>
  `,
})
export class KeykeeperMoveToFolderDialogComponent {
  private readonly params = inject<MoveToFolderParams>(DIALOG_DATA);
  private readonly dialogRef = inject<DialogRef<MoveToFolderChoice>>(DialogRef);
  private readonly accountService = inject(AccountService);
  private readonly folderService = inject(FolderService);
  private readonly i18nService = inject(I18nService);

  protected readonly form = inject(FormBuilder).group({ folderId: [null as string | null] });

  protected readonly title =
    this.params.count === 1
      ? this.i18nService.t("keykeeperSelectMoveTitleOne")
      : this.i18nService.t("keykeeperSelectMoveTitle", this.params.count);

  /** The person's folders, then "No folder"; the first folder is picked to start. */
  protected readonly folders$ = this.accountService.activeAccount$.pipe(
    getUserId,
    switchMap((userId) => this.folderService.folderViews$(userId)),
    tap((folders) => {
      if (this.form.controls.folderId.pristine) {
        this.form.controls.folderId.setValue(folders.find((f) => f.id != null)?.id ?? null);
      }
    }),
  );

  protected readonly submit = async () => {
    void this.dialogRef.close({ folderId: this.form.value.folderId ?? null });
  };

  /** Closes with no choice, so nothing moves. */
  protected cancel() {
    void this.dialogRef.close();
  }

  static open(dialogService: DialogService, params: MoveToFolderParams) {
    return dialogService.open<MoveToFolderChoice, MoveToFolderParams>(
      KeykeeperMoveToFolderDialogComponent,
      { data: params },
    );
  }
}
