import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { ReactiveFormsModule } from "@angular/forms";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { CheckboxModule, FormFieldModule } from "@bitwarden/components";

import { CUSTOM_ROLE_PERMISSIONS, CustomRoleForm } from "./custom-role";

/**
 * Keykeeper: the custom role's permissions in the invite and edit member
 * dialogs, every one our server enforces, together (custom-role.ts). Each
 * says in a line what it lets someone do where that isn't plain from its
 * name.
 */
@Component({
  selector: "app-keykeeper-custom-role-permissions",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, JslibModule, CheckboxModule, FormFieldModule],
  template: `
    <fieldset
      class="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-x-6 tw-mb-4"
      [formGroup]="form()"
      data-testid="custom-role-permissions"
    >
      <legend class="tw-sr-only">{{ "permissions" | i18n }}</legend>
      @for (permission of permissions; track permission.key) {
        <bit-form-control>
          <input type="checkbox" bitCheckbox [formControlName]="permission.key" />
          <bit-label>{{ permission.label | i18n }}</bit-label>
          @if (hintOf(permission); as hint) {
            <bit-hint>{{ hint | i18n }}</bit-hint>
          }
        </bit-form-control>
      }
    </fieldset>
  `,
})
export class KeykeeperCustomRolePermissionsComponent {
  readonly form = input.required<CustomRoleForm>();

  protected readonly permissions = CUSTOM_ROLE_PERMISSIONS;

  protected hintOf(permission: (typeof CUSTOM_ROLE_PERMISSIONS)[number]): string | undefined {
    return "hint" in permission ? permission.hint : undefined;
  }
}
