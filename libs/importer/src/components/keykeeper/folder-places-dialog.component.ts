import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormArray, FormControl, ReactiveFormsModule } from "@angular/forms";

import {
  ButtonModule,
  CalloutModule,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
  FormFieldModule,
  IconComponent,
  SelectModule,
  TypographyModule,
} from "@bitwarden/components";

import { FolderQuestion, SourceFolder } from "../../services/keykeeper/folder-places";

/** A new shared folder with the folder's name. Shared folders' ids are UUIDs, so never this. */
export const NEW_FOLDER = "new";
/** Leave the folder's items out. */
export const LEAVE_OUT = "leave";
/** NEW_FOLDER, LEAVE_OUT, or the id of a shared folder already in the organization. */
export type FolderPlaceChoice = string;

export type FolderPlacesDialogData = {
  /** The organization the items go into. */
  organizationName: string;
  /** The import's "into a shared folder" choice, if any: where items with no folder go, and what new shared folders go inside. */
  target: string | null;
  /** Whether the person may make shared folders here. */
  mayMake: boolean;
  /** The shared folders already here that the person can add items to, sorted by name. */
  existing: { id: string; name: string }[];
  question: FolderQuestion;
  /** What each folder starts as, by its index; null for nothing yet. */
  start: (FolderPlaceChoice | null)[];
};

function items(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

/**
 * Keykeeper: before an import into an organization saves anything, where each
 * of the file's folders goes: a new shared folder with its name, a shared
 * folder already here that the person can add items to, or left out. Each
 * folder has its own row, subfolders under their parents, so choosing a
 * parent's place never moves its subfolders (folder-places.ts;
 * services/keykeeper/folder-places.ts; DESIGN.md, "Importing from other
 * password managers").
 */
@Component({
  selector: "tools-keykeeper-folder-places-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonModule,
    CalloutModule,
    DialogModule,
    FormFieldModule,
    IconComponent,
    ReactiveFormsModule,
    SelectModule,
    TypographyModule,
  ],
  template: `
    <bit-dialog dialogSize="large">
      <span bitDialogTitle>Where should each folder go in {{ data.organizationName }}?</span>
      <div bitDialogContent>
        <p bitTypography="body1" data-testid="folder-places-intro">{{ intro }}</p>
        @if (!data.mayMake) {
          <bit-callout type="info" data-testid="folder-places-no-new">{{ whyNoNew }}</bit-callout>
        }
        @for (f of data.question.folders; track f.index) {
          <div
            class="tw-grid tw-grid-cols-2 tw-items-center tw-gap-x-4 tw-border-0 tw-border-b tw-border-solid tw-border-border-base tw-py-2"
            data-testid="folder-place"
          >
            <div class="tw-min-w-0" [style.padding-inline-start.rem]="f.depth * 1.25">
              <div class="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                <bit-icon name="bwi-folder" aria-hidden="true" class="tw-text-muted" />
                <span class="tw-truncate tw-font-medium" [title]="f.name">{{ f.label }}</span>
              </div>
              <div bitTypography="helper" class="tw-text-muted">{{ count(f) }}</div>
            </div>
            <bit-form-field disableMargin>
              <bit-label class="tw-sr-only">Where {{ f.name }} goes</bit-label>
              <bit-select [formControl]="choices.at(f.index)">
                @if (data.mayMake) {
                  <bit-option
                    [value]="newFolder"
                    label="New shared folder"
                    icon="bwi-plus-circle"
                  />
                }
                @for (c of data.existing; track c.id) {
                  <bit-option [value]="c.id" [label]="c.name" icon="bwi-collection-shared" />
                }
                <bit-option [value]="leaveOut" label="Leave out" icon="bwi-minus-circle" />
              </bit-select>
              @if (keepsOwnPlaces(f)) {
                <bit-hint>Its subfolders go where their own rows say.</bit-hint>
              }
            </bit-form-field>
          </div>
        }
        <p
          bitTypography="body2"
          class="tw-mb-0 tw-mt-3"
          aria-live="polite"
          data-testid="folder-places-total"
        >
          {{ status() }}
        </p>
      </div>
      <ng-container bitDialogFooter>
        <button
          bitButton
          buttonType="primary"
          type="button"
          [disabled]="!ready()"
          (click)="import()"
        >
          Import
        </button>
        <button bitButton buttonType="secondary" type="button" bitDialogClose>Cancel</button>
      </ng-container>
    </bit-dialog>
  `,
})
export class KeykeeperFolderPlacesDialogComponent {
  protected readonly data = inject<FolderPlacesDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject<DialogRef<FolderPlaceChoice[]>>(DialogRef);

  protected readonly newFolder = NEW_FOLDER;
  protected readonly leaveOut = LEAVE_OUT;

  /** One for each of the file's folders, by its index. */
  protected readonly choices = new FormArray(
    this.data.start.map((choice) => new FormControl<FolderPlaceChoice | null>(choice)),
  );
  private readonly chosen = toSignal(this.choices.valueChanges, {
    initialValue: this.choices.value,
  });

  private readonly itemFolders = this.data.question.itemFolders;
  private readonly loose = this.itemFolders.filter((f) => f.length === 0).length;

  /** How many items are left out: those every one of whose folders is. */
  private readonly leftOut = computed(() => {
    const chosen = this.chosen();
    return this.itemFolders.filter(
      (folders) => folders.length > 0 && folders.every((f) => chosen[f] === LEAVE_OUT),
    ).length;
  });

  private readonly allChosen = computed(() => this.chosen().every((c) => c != null));

  protected readonly ready = computed(
    () =>
      this.allChosen() &&
      (this.itemFolders.length === 0 || this.leftOut() < this.itemFolders.length),
  );

  protected readonly status = computed(() => {
    if (!this.allChosen()) {
      return "Choose where each folder goes.";
    }
    const total = this.itemFolders.length;
    const leftOut = this.leftOut();
    if (total > 0 && leftOut === total) {
      return "Every item is left out, so there's nothing to import.";
    }
    return leftOut > 0
      ? `Imports ${items(total - leftOut)} and leaves out ${leftOut}.`
      : `Imports ${items(total)}.`;
  });

  protected readonly intro = this.introText();
  protected readonly whyNoNew =
    this.data.existing.length > 0
      ? `You can't make shared folders in ${this.data.organizationName}, so each folder goes ` +
        "into one that's already here, or is left out. An owner or admin can make new ones."
      : `You can't make shared folders in ${this.data.organizationName}, and there are none ` +
        "here you can add items to, so the file's folders can only be left out. An owner or " +
        "admin can make new ones.";

  protected count(folder: SourceFolder): string {
    return folder.items === 0 ? "No items" : items(folder.items);
  }

  /** A parent whose place isn't a new folder: its subfolders keep their own places. */
  protected keepsOwnPlaces(folder: SourceFolder): boolean {
    const choice = this.chosen()[folder.index];
    return folder.subfolders > 0 && choice != null && choice !== NEW_FOLDER;
  }

  private introText(): string {
    const folders = this.data.question.folders;
    const target = this.data.target;
    const sentences = [
      `This file has ${items(this.itemFolders.length)} in ${folders.length} ` +
        `${folders.length === 1 ? "folder" : "folders"}.`,
    ];
    if (this.data.mayMake) {
      sentences.push(
        "Each becomes a new shared folder unless you choose one that's already here, or leave it out.",
      );
    }
    if (folders.some((f) => f.depth > 0)) {
      sentences.push("Subfolders have rows of their own.");
    }
    if (target != null && this.data.mayMake) {
      sentences.push(`New shared folders go inside ${target}.`);
    }
    if (this.loose > 0) {
      sentences.push(
        target != null
          ? `The ${items(this.loose)} with no folder ${this.loose === 1 ? "goes" : "go"} into ${target}.`
          : `The ${items(this.loose)} with no folder won't be in a shared folder.`,
      );
    }
    return sentences.join(" ");
  }

  protected import() {
    if (!this.ready()) {
      return;
    }
    void this.dialogRef.close(this.choices.value as FolderPlaceChoice[]);
  }

  static open(dialogService: DialogService, data: FolderPlacesDialogData) {
    return dialogService.open<FolderPlaceChoice[], FolderPlacesDialogData>(
      KeykeeperFolderPlacesDialogComponent,
      { data },
    );
  }
}
