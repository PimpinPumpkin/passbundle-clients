import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";

import { OrgBrowserAutofill } from "@bitwarden/admin-console/common";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

/** What each choice says once it's saved. */
export const SAVED_MESSAGES: Record<OrgBrowserAutofill["mode"], string> = {
  unchanged: "The browsers' card and address autofill are left as they are",
  off: "The browsers' card and address autofill are off",
  offAndImport: "The browsers' card and address autofill are off, with the offer to bring them in",
};

/**
 * Keykeeper: what the organization does with the browsers' own card and
 * address autofill, on its Settings page, for owners and admins (and its
 * MSP's admins); the server answers no one else, and the card stays hidden.
 * Left as is by default. The extension turns them off in work profiles, and
 * the install command carries the setting to the browsers' policies. See
 * DESIGN.md, "Addresses and cards".
 */
@Component({
  selector: "app-keykeeper-browser-autofill-setting",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (setting(); as s) {
      <section data-testid="browser-autofill-setting">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Browsers' card and address autofill</h1>
        <p bitTypography="body1">
          Chrome, Edge, and Firefox can save and fill cards and addresses themselves. Turn that off
          so people's cards and addresses live in {{ "keykeeperProductName" | i18n }} and fill from
          there.
        </p>
        @if (s.msp && s.requiredByMsp) {
          <p bitTypography="body2" data-testid="browser-autofill-setting-msp">
            <span bitBadge variant="primary" startIcon="bwi-lock" [truncate]="false"
              >Required by {{ s.msp.name }}</span
            >
            {{ s.msp.name }} sets this for every client, so only {{ s.msp.name }}'s console changes
            it.
          </p>
        } @else if (s.msp) {
          <p bitTypography="body2" data-testid="browser-autofill-setting-msp">
            {{ s.msp.name }} sets this by default. Changing it here makes it this organization's own
            setting.
          </p>
        }
        <form
          [formGroup]="form"
          [bitSubmit]="save"
          aria-label="Browsers' card and address autofill"
        >
          <bit-radio-group formControlName="mode">
            <bit-radio-button value="unchanged">
              <bit-label>Leave as is</bit-label>
              <bit-hint
                >The browsers keep saving and filling cards and addresses as they do now.</bit-hint
              >
            </bit-radio-button>
            <bit-radio-button value="off">
              <bit-label>Turn off</bit-label>
              <bit-hint>
                The browsers stop saving and filling cards and addresses in people's work profiles,
                where the extension is signed in to this organization. What they saved stays in the
                browser.
              </bit-hint>
            </bit-radio-button>
            <bit-radio-button value="offAndImport">
              <bit-label>Turn off, and offer to bring them in</bit-label>
              <bit-hint>
                The same, and the extension offers each person, once, to move their saved cards and
                addresses into {{ "keykeeperProductName" | i18n }}.
              </bit-hint>
            </bit-radio-button>
          </bit-radio-group>
          <p bitTypography="body2" data-testid="browser-autofill-setting-computers">
            On computers the install command set up, turning it off covers every profile in Chrome,
            Edge, and Firefox, personal ones too, since browsers take that policy per computer. The
            install command changes with this setting: run the new one on computers set up before.
          </p>
          @if (!s.requiredByMsp) {
            <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
          }
        </form>
      </section>
    }
  `,
})
export class KeykeeperBrowserAutofillSettingComponent {
  readonly organizationId = input.required<string>();

  protected readonly setting = signal<OrgBrowserAutofill | null>(null);
  protected readonly form = new FormGroup({
    mode: new FormControl<OrgBrowserAutofill["mode"]>("unchanged", { nonNullable: true }),
  });

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.organizationId();
      // Not an owner or admin: the server says not found, and the card stays hidden.
      this.api.getOrgBrowserAutofill(id).then(
        (s) => this.show(s),
        () => this.setting.set(null),
      );
    });
  }

  private show(setting: OrgBrowserAutofill) {
    this.setting.set(setting);
    this.form.controls.mode.setValue(setting.mode);
    // The MSP sets it for every client, so it's not this page's to change.
    if (setting.requiredByMsp) {
      this.form.controls.mode.disable();
    } else {
      this.form.controls.mode.enable();
    }
  }

  protected readonly save = async () => {
    try {
      const saved = await this.api.setOrgBrowserAutofill(
        this.organizationId(),
        this.form.controls.mode.value,
      );
      this.show(saved);
      this.toastService.showToast({ variant: "success", message: SAVED_MESSAGES[saved.mode] });
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    }
  };
}
