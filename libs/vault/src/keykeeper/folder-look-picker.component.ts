import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  forwardRef,
  inject,
  input,
  signal,
  viewChildren,
} from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  DEFAULT_FOLDER_TONE,
  FOLDER_ICONS,
  FOLDER_TONES,
  FolderLook,
  folderTileLook,
  folderTone,
} from "@bitwarden/common/vault/keykeeper/folder-looks";
import { IconModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { KeykeeperCategoryTileComponent } from "./category-tile.component";

let nextId = 0;

/** One choice in a group: an icon (or the plain folder), or a color. */
type Choice = { id: string | null; label: string; glyph?: string; light?: string; dark?: string };

/**
 * Keykeeper: a shared folder's icon and color, picked from our flat set
 * (DESIGN.md, "Folder icons"), in its dialog: a preview of the folder as the
 * menu shows it, then the icons and the colors, each a group of radio
 * buttons. Arrow keys move through a group and pick as they go, Home and End
 * jump to its ends, and Tab goes from one group to the next, as radio groups
 * do. The value is the look, or null for the plain folder, which keeps its
 * glyph; picking a color first gives the folder glyph that color, and an
 * icon first gets the first color.
 */
@Component({
  selector: "vault-keykeeper-folder-look-picker",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe, IconModule, KeykeeperCategoryTileComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => KeykeeperFolderLookPickerComponent),
      multi: true,
    },
  ],
  template: `
    <div class="tw-mb-4" data-testid="keykeeper-folder-look">
      <div class="tw-mb-2 tw-flex tw-items-center tw-gap-3" data-kk="preview">
        @if (tile(); as tile) {
          <vault-keykeeper-category-tile [look]="tile" [size]="36" />
        } @else {
          <span data-kk="plain" aria-hidden="true">
            <bit-icon name="bwi-collection-shared" />
          </span>
        }
        <span class="tw-min-w-0">
          <span
            class="tw-block tw-font-semibold tw-truncate"
            data-testid="keykeeper-folder-look-name"
          >
            {{ name() || ("keykeeperFolderLookUnnamed" | i18n) }}
          </span>
          <span class="tw-block tw-text-sm tw-text-muted">{{
            "keykeeperFolderLookPreview" | i18n
          }}</span>
        </span>
      </div>

      <span [id]="iconsLabel" class="tw-mb-1 tw-block tw-text-sm tw-font-semibold">
        {{ "keykeeperFolderLookIcon" | i18n }}
      </span>
      <div
        role="radiogroup"
        [attr.aria-labelledby]="iconsLabel"
        class="tw-mb-3 tw-flex tw-flex-wrap tw-gap-1"
        data-testid="keykeeper-folder-icons"
      >
        @for (choice of icons(); track choice.id; let i = $index) {
          <button
            #icon
            type="button"
            role="radio"
            data-kk="icon"
            [attr.data-icon]="choice.id ?? 'plain'"
            [attr.aria-checked]="choice.id === iconId()"
            [attr.aria-label]="choice.label"
            [title]="choice.label"
            [tabIndex]="i === iconStop() ? 0 : -1"
            [disabled]="disabled()"
            [style.--pb-jewel]="pickedTone().light"
            [style.--pb-jewel-dark]="pickedTone().dark"
            (click)="pickIcon(choice.id)"
            (keydown)="move($event, i, 'icon')"
          >
            @if (choice.glyph) {
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path [attr.d]="choice.glyph"></path>
              </svg>
            } @else {
              <bit-icon name="bwi-collection-shared" aria-hidden="true" />
            }
          </button>
        }
      </div>

      <span [id]="tonesLabel" class="tw-mb-1 tw-block tw-text-sm tw-font-semibold">
        {{ "keykeeperFolderLookColor" | i18n }}
      </span>
      <div
        role="radiogroup"
        [attr.aria-labelledby]="tonesLabel"
        class="tw-flex tw-flex-wrap tw-gap-1"
        data-testid="keykeeper-folder-tones"
      >
        @for (choice of tones; track choice.id; let i = $index) {
          <button
            #tone
            type="button"
            role="radio"
            data-kk="tone"
            [attr.data-tone]="choice.id"
            [attr.aria-checked]="choice.id === value()?.tone"
            [attr.aria-label]="choice.label"
            [title]="choice.label"
            [tabIndex]="i === toneStop() ? 0 : -1"
            [disabled]="disabled()"
            [style.--pb-swatch]="choice.light"
            [style.--pb-swatch-dark]="choice.dark"
            (click)="pickTone(choice.id!)"
            (keydown)="move($event, i, 'tone')"
          >
            <span data-kk="swatch" aria-hidden="true"></span>
          </button>
        }
      </div>
      <p class="tw-mb-0 tw-mt-2 tw-text-sm tw-text-muted">{{ "keykeeperFolderLookHint" | i18n }}</p>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    [data-kk="plain"] {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      font-size: 20px;
      color: var(--color-text-muted, currentColor);
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--color-text-muted, currentColor);
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: var(--pb-sunken, rgb(0 0 0 / 0.05));
    }
    button[data-kk="icon"][aria-checked="true"] {
      color: var(--pb-jewel);
      background: color-mix(in srgb, var(--pb-jewel) 11%, transparent);
      border-color: var(--pb-jewel);
    }
    :host-context(.theme_dark) button[data-kk="icon"][aria-checked="true"] {
      color: var(--pb-jewel-dark);
      background: color-mix(in srgb, var(--pb-jewel-dark) 14%, transparent);
      border-color: var(--pb-jewel-dark);
    }
    button[data-kk="tone"][aria-checked="true"] {
      border-color: var(--pb-swatch);
    }
    :host-context(.theme_dark) button[data-kk="tone"][aria-checked="true"] {
      border-color: var(--pb-swatch-dark);
    }
    button:focus-visible {
      outline: 2px solid var(--pb-brand, rgb(var(--color-primary-600)));
      outline-offset: 1px;
    }
    button:disabled {
      cursor: default;
      opacity: 0.5;
    }
    [data-kk="swatch"] {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--pb-swatch);
    }
    :host-context(.theme_dark) [data-kk="swatch"] {
      background: var(--pb-swatch-dark);
    }
  `,
})
export class KeykeeperFolderLookPickerComponent implements ControlValueAccessor {
  /** The folder's name, for the preview. */
  readonly name = input<string | null | undefined>("");

  protected readonly iconsLabel = `keykeeper-folder-icons-${++nextId}`;
  protected readonly tonesLabel = `keykeeper-folder-tones-${nextId}`;

  protected readonly value = signal<FolderLook | null>(null);
  protected readonly disabled = signal(false);

  private readonly iconButtons = viewChildren<ElementRef<HTMLButtonElement>>("icon");
  private readonly toneButtons = viewChildren<ElementRef<HTMLButtonElement>>("tone");

  private readonly i18nService = inject(I18nService);

  protected readonly tones: readonly Choice[] = FOLDER_TONES;
  /** The plain folder (no icon of its own), then the icons. */
  protected readonly icons = signal<Choice[]>([
    { id: null, label: this.i18nService.t("keykeeperFolderLookPlain") },
    ...FOLDER_ICONS,
  ]);

  protected readonly iconId = computed(() => this.value()?.icon ?? null);
  protected readonly tile = computed(() => folderTileLook(this.value()));
  /** The color the icons are drawn in when picked: the folder's, or the first. */
  protected readonly pickedTone = computed(
    () => folderTone(this.value()?.tone) ?? folderTone(DEFAULT_FOLDER_TONE)!,
  );
  /** Where Tab enters each group: the picked choice, or the first. */
  protected readonly iconStop = computed(() =>
    Math.max(
      0,
      this.icons().findIndex((c) => c.id === this.iconId()),
    ),
  );
  protected readonly toneStop = computed(() =>
    Math.max(
      0,
      this.tones.findIndex((c) => c.id === this.value()?.tone),
    ),
  );

  /** The form's callbacks, once it registers them. */
  private readonly form: {
    changed: (value: FolderLook | null) => void;
    touched: () => void;
  } = { changed: () => {}, touched: () => {} };

  writeValue(value: FolderLook | null | undefined): void {
    this.value.set(value ?? null);
  }

  registerOnChange(fn: (value: FolderLook | null) => void): void {
    this.form.changed = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.form.touched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  protected pickIcon(icon: string | null) {
    const current = this.value();
    this.set(icon == null ? null : { icon, tone: current?.tone ?? DEFAULT_FOLDER_TONE });
  }

  protected pickTone(tone: string) {
    this.set({ icon: this.value()?.icon ?? "folder", tone });
  }

  /** Arrow keys, Home, and End within a group, picking as they go. */
  protected move(event: KeyboardEvent, at: number, group: "icon" | "tone") {
    const count = group === "icon" ? this.icons().length : this.tones.length;
    let to: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        to = (at + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        to = (at - 1 + count) % count;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (group === "icon") {
      this.pickIcon(this.icons()[to].id);
      this.iconButtons()[to]?.nativeElement.focus();
    } else {
      this.pickTone(this.tones[to].id!);
      this.toneButtons()[to]?.nativeElement.focus();
    }
  }

  private set(look: FolderLook | null) {
    this.value.set(look);
    this.form.changed(look);
    this.form.touched();
  }
}
