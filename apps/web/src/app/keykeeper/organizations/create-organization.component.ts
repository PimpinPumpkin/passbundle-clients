import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { FormBuilder, Validators } from "@angular/forms";
import { Router } from "@angular/router";

import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { DialogService, ToastService } from "@bitwarden/components";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";
import { ClientPreset, KeykeeperMspApiService } from "../msp/msp-api.service";
import { KeykeeperTwoStepDetour } from "../two-step-setup/two-step-detour";

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
        they get in as soon as they accept, unless you ask for approval in its settings, under
        Joining and security.
      </p>
      <!-- Keykeeper: the way into the MSP console for someone who isn't on an MSP yet. -->
      <p bitTypography="body2" data-testid="create-org-msp">
        Run IT for several companies?
        <a bitLink routerLink="/msp">Set up your MSP</a> instead: one console for every client, with
        default policies, templates, and an install command for each.
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
              one work account per person, and Everyone and Admins shared folders. You also get an
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
        @if (form.controls.preset.value === "business" && needsTwoStep()) {
          <bit-callout type="warning" [title]="null" data-testid="create-org-two-step">
            <p>
              A business requires two-step login of its owners and admins: an authenticator app, a
              security key or passkey, or Duo. Set it up before you make the organization, so you
              stay signed in. It takes a minute, and what you type here stays. A family or a group
              doesn't need it.
            </p>
            <button bitButton buttonType="secondary" type="button" (click)="setUpTwoStep()">
              Set up two-step login
            </button>
          </bit-callout>
        }
        <button bitButton bitFormButton buttonType="primary" type="submit">
          Create organization
        </button>
      </form>
    </bit-container>
  `,
})
export class KeykeeperCreateOrganizationComponent implements OnInit {
  /** Keykeeper: no two-step login that counts for an owner yet (DESIGN.md, "Two-step login for admins"). */
  protected readonly needsTwoStep = signal(false);
  protected readonly form = this.formBuilder.nonNullable.group({
    name: ["", [Validators.required, Validators.maxLength(100)]],
    preset: this.formBuilder.nonNullable.control<ClientPreset>("business"),
  });

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperMspApiService,
    private readonly router: Router,
    private readonly toastService: ToastService,
    private readonly dialogService: DialogService,
    private readonly twoStepDetour: KeykeeperTwoStepDetour,
  ) {}

  async ngOnInit() {
    // Back from setting up two-step login: the form as they left it.
    const back = this.twoStepDetour.take("/create-organization");
    if (back != null) {
      this.form.setValue({ name: back.name, preset: back.preset ?? "business" });
    }
    await this.checkTwoStep();
  }

  /** Whether the person has two-step login that counts; unknown counts as yes, and the server decides. */
  private async checkTwoStep(): Promise<boolean> {
    try {
      const has = await this.api.hasQualifyingTwoStep();
      this.needsTwoStep.set(!has);
      return has;
    } catch {
      return true;
    }
  }

  /** To the Two-step login page, with a way back here that keeps the form. */
  protected async setUpTwoStep() {
    await this.twoStepDetour.start({
      path: "/create-organization",
      label: "New organization",
      name: this.form.controls.name.value,
      preset: this.form.controls.preset.value,
    });
  }

  protected readonly submit = async () => {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const name = this.form.controls.name.value.trim();
    // A business requires two-step login of its owners: without it, making
    // one would end this session at once (DESIGN.md, "Two-step login for
    // admins"), so it says so first and offers to set it up. Checked now: it
    // may have been set up since the page opened.
    if (this.form.controls.preset.value === "business" && !(await this.checkTwoStep())) {
      const setUp = await this.dialogService.openSimpleDialog({
        title: "Set up two-step login first",
        content: `A business requires two-step login of its owners and admins: an authenticator app, a security key or passkey, or Duo. Email codes don't count. Without it, making ${name} would sign you out right away. Set it up now, and come back here to make ${name}.`,
        acceptButtonText: "Set up two-step login",
        cancelButtonText: "Not now",
        type: "warning",
      });
      if (setUp) {
        await this.setUpTwoStep();
      }
      return;
    }
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
