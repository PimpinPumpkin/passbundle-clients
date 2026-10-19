import { ChangeDetectionStrategy, Component } from "@angular/core";
import { FormBuilder, Validators } from "@angular/forms";
import { Router } from "@angular/router";

import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { ToastService } from "@bitwarden/components";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";
import { ClientPreset, KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: "New organization" on our own server. Upstream asks a self-hosted
 * server for a license file here, and its cloud form is about plans and
 * payment, neither of which applies. The organization's keys are made in the
 * browser with upstream's own code, as the MSP console's "Add client" does.
 * A business starts with the Business preset and an install command, as an
 * MSP's client does; a family or group starts as upstream's organization. See
 * DESIGN.md, "Joining" and "A company's own IT".
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule],
  template: `
    <app-header></app-header>
    <bit-container>
      <p bitTypography="body1">
        An organization shares items with the people you invite. Invite them from its Members page:
        they get in as soon as they accept, unless you ask for approval on its Settings page.
      </p>
      <form [formGroup]="form" [bitSubmit]="submit" class="tw-max-w-xl">
        <bit-form-field>
          <bit-label>Organization name</bit-label>
          <input bitInput type="text" formControlName="name" />
        </bit-form-field>
        <bit-radio-group formControlName="preset" [block]="true" class="tw-mb-6 tw-block">
          <bit-label>It's for</bit-label>
          <bit-radio-button value="business">
            <bit-label>A business</bit-label>
            <bit-hint>
              Starts with account recovery for forgotten master passwords, strong master passwords,
              one work account per person, and Everyone and Admins collections. You also get an
              install command for rolling it out. Change any of it on the organization's Settings
              and Policies pages.
            </bit-hint>
          </bit-radio-button>
          <bit-radio-button value="none">
            <bit-label>A family or a group</bit-label>
            <bit-hint
              >No policies: share with the people you invite, and add rules later if you want
              them.</bit-hint
            >
          </bit-radio-button>
        </bit-radio-group>
        <button bitButton bitFormButton buttonType="primary" type="submit">
          Create organization
        </button>
      </form>
    </bit-container>
  `,
})
export class KeykeeperCreateOrganizationComponent {
  protected readonly form = this.formBuilder.nonNullable.group({
    name: ["", [Validators.required, Validators.maxLength(100)]],
    preset: this.formBuilder.nonNullable.control<ClientPreset>("business"),
  });

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperMspApiService,
    private readonly router: Router,
    private readonly toastService: ToastService,
  ) {}

  protected readonly submit = async () => {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const name = this.form.controls.name.value.trim();
    try {
      const id = await this.api.createOrganization(name, this.form.controls.preset.value);
      this.toastService.showToast({ variant: "success", message: `Created ${name}` });
      await this.router.navigate(["/organizations", id, "members"]);
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  };
}
