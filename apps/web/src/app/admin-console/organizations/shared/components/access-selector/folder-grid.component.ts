import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";

import {
  FOLDER_CAPABILITIES,
  FolderCapability,
  FolderGrid,
  FOLDER_PRESETS,
  toggleCapability,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { CheckboxModule, FormControlModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

/**
 * Keykeeper: the Custom grid for one person or group in a shared folder, one
 * checkbox per capability. "See items" is having the folder at all, so it
 * stays checked; removing the row takes it away. The grid keeps its own rules
 * as boxes are checked (folder-permissions.ts, toggleCapability), and says
 * which capabilities only our apps can hold to. See DESIGN.md, "Folders and
 * permissions".
 */
@Component({
  selector: "app-keykeeper-folder-grid",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CheckboxModule, FormControlModule, I18nPipe],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FolderGridComponent),
      multi: true,
    },
  ],
  template: `
    <fieldset
      class="tw-m-0 tw-border-0 tw-p-0"
      data-testid="keykeeper-folder-grid"
      [attr.aria-label]="label()"
    >
      <div class="tw-grid tw-grid-cols-1 tw-gap-x-6 sm:tw-grid-cols-2 lg:tw-grid-cols-3">
        <bit-form-control>
          <input type="checkbox" bitCheckbox [checked]="true" [disabled]="true" />
          <bit-label>{{ "keykeeperCapSeeItems" | i18n }}</bit-label>
        </bit-form-control>
        @for (cap of capabilities; track cap.key) {
          <bit-form-control>
            <input
              type="checkbox"
              bitCheckbox
              [attr.data-capability]="cap.key"
              [checked]="grid()[cap.key]"
              [disabled]="disabled()"
              (change)="toggle(cap.key, $any($event.target).checked)"
            />
            <bit-label>{{ cap.label | i18n }}</bit-label>
          </bit-form-control>
        }
      </div>
      <p class="tw-mb-0 tw-mt-1 tw-text-sm tw-text-muted">
        {{ "keykeeperGridAppsEnforce" | i18n }}
      </p>
    </fieldset>
  `,
})
export class FolderGridComponent implements ControlValueAccessor {
  /** Who the grid is for, for screen readers. */
  readonly label = input<string>();

  protected readonly capabilities = FOLDER_CAPABILITIES;
  protected readonly grid = signal<FolderGrid>({ ...FOLDER_PRESETS.view });
  protected readonly disabled = signal(false);

  private readonly onChange = signal<(grid: FolderGrid) => void>(() => {});
  private readonly onTouched = signal<() => void>(() => {});

  protected toggle(capability: FolderCapability, on: boolean) {
    const next = toggleCapability(this.grid(), capability, on);
    this.grid.set(next);
    this.onChange()(next);
    this.onTouched()();
  }

  writeValue(grid: FolderGrid | null | undefined): void {
    this.grid.set({ ...(grid ?? FOLDER_PRESETS.view) });
  }

  registerOnChange(fn: (grid: FolderGrid) => void): void {
    this.onChange.set(fn);
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched.set(fn);
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
