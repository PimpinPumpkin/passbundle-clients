import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";

import { OrgPasswordChange } from "@bitwarden/admin-console/common";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: whether the organization lets its people use assisted password
 * change on its items, on its Settings page, for owners and admins (and its
 * MSP's admins); the server answers no one else, and the card stays hidden.
 * On by default. See DESIGN.md, "Assisted password change", "Organizations".
 */
@Component({
  selector: "app-keykeeper-password-change-setting",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (setting(); as s) {
      <section data-testid="password-change-setting">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Assisted password change</h1>
        <p bitTypography="body1">
          Change password in the browser extension changes a login's password on its site: it saves
          a new password to the item first, then fills in the site's form and submits it. People can
          use it only on items they can edit and see the passwords of. Each change is in the event
          log.
        </p>
        @if (s.msp && s.requiredByMsp) {
          <p bitTypography="body2" data-testid="password-change-setting-msp">
            <span bitBadge variant="primary" startIcon="bwi-lock" [truncate]="false"
              >Required by {{ s.msp.name }}</span
            >
            {{ s.msp.name }} sets this for every client, so only {{ s.msp.name }}'s console changes
            it.
          </p>
        } @else if (s.msp) {
          <p bitTypography="body2" data-testid="password-change-setting-msp">
            {{ s.msp.name }} sets this by default. Changing it here makes it this organization's own
            setting.
          </p>
        }
        <form [formGroup]="form" [bitSubmit]="save" aria-label="Assisted password change">
          <bit-form-control>
            <input type="checkbox" bitCheckbox formControlName="allowed" />
            <bit-label>Let people change passwords on sites with the browser extension</bit-label>
            <bit-hint>
              Turned off, Change password only opens the site's change-password page, and people
              change it themselves.
            </bit-hint>
          </bit-form-control>
          @if (!s.requiredByMsp) {
            <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
          }
        </form>
      </section>
    }
  `,
})
export class KeykeeperPasswordChangeSettingComponent {
  readonly organizationId = input.required<string>();

  protected readonly setting = signal<OrgPasswordChange | null>(null);
  protected readonly form = new FormGroup({
    allowed: new FormControl(true, { nonNullable: true }),
  });

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.organizationId();
      // Not an owner or admin: the server says not found, and the card stays hidden.
      this.api.getOrgPasswordChange(id).then(
        (s) => this.show(s),
        () => this.setting.set(null),
      );
    });
  }

  private show(setting: OrgPasswordChange) {
    this.setting.set(setting);
    this.form.controls.allowed.setValue(setting.allowed);
    // The MSP sets it for every client, so it's not this page's to change.
    if (setting.requiredByMsp) {
      this.form.controls.allowed.disable();
    } else {
      this.form.controls.allowed.enable();
    }
  }

  protected readonly save = async () => {
    const allowed = this.form.controls.allowed.value;
    try {
      const saved = await this.api.setOrgPasswordChange(this.organizationId(), allowed);
      this.show(saved);
      this.toastService.showToast({
        variant: "success",
        message: saved.allowed
          ? "Assisted password change is on"
          : "Assisted password change is off",
      });
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    }
  };
}
