import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";
import { firstValueFrom, map } from "rxjs";

import { OrgAdminTwoStep, TwoStepNotSetUp } from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

/** How the list names someone's role. */
export function twoStepRoleLabel(person: TwoStepNotSetUp): string {
  switch (person.role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "technician":
      return "Technician";
    default:
      return "Custom role";
  }
}

/**
 * Keykeeper: two-step login for this organization's admins, on its Settings
 * page, for owners and admins (and its MSP's admins); the server answers no
 * one else, and the card stays hidden. Shows who it covers that hasn't set up
 * a method that counts. See DESIGN.md, "Two-step login for admins".
 */
@Component({
  selector: "app-keykeeper-admin-two-step",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (setting(); as s) {
      <section data-testid="admin-two-step">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Two-step login for admins</h1>
        <p bitTypography="body1">
          Owners, admins, and custom roles that manage members, policies, or account recovery must
          use an authenticator app, a security key or passkey, or Duo. Email codes don't count.
          Anyone without one sets it up the next time they sign in, before anything else. Admins who
          sign in with this organization's single sign-on are covered by it there.
        </p>
        @if (s.msp) {
          <p bitTypography="body2" data-testid="admin-two-step-msp">
            {{ s.msp.name }} turns this on by default. Changing it here makes it this organization's
            own setting.
          </p>
        }
        <form [formGroup]="form" [bitSubmit]="save" aria-label="Two-step login for admins">
          <bit-form-control>
            <input type="checkbox" bitCheckbox formControlName="required" />
            <bit-label>Require two-step login for admins</bit-label>
          </bit-form-control>
          <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
        </form>
        <h2 bitTypography="h3" class="tw-mt-6">Not set up yet</h2>
        @if (meNotSetUp()) {
          <bit-callout type="warning" [title]="null" data-testid="admin-two-step-you">
            You haven't set up two-step login.
            @if (s.required) {
              You'll be asked to the next time you sign in.
            }
            <a bitLink routerLink="/settings/security/two-factor">Set it up now</a>
          </bit-callout>
        }
        <ul class="tw-list-none tw-pl-0" data-testid="admin-two-step-not-set-up">
          @for (p of s.notSetUp; track p.userId) {
            <li class="tw-py-1">
              <span class="tw-font-semibold">{{ p.name || p.email }}</span>
              @if (p.name) {
                <span class="tw-text-muted"> {{ p.email }}</span>
              }
              <span class="tw-text-muted"> · {{ roleLabel(p) }}</span>
              @if (p.fromMsp) {
                <span class="tw-text-muted"> · from {{ s.msp?.name ?? "your IT provider" }}</span>
              }
              @if (p.singleSignOn) {
                <span class="tw-text-muted">
                  · covered when they sign in with single sign-on, not with a password</span
                >
              }
            </li>
          } @empty {
            <li class="tw-text-muted">Everyone it covers has set it up.</li>
          }
        </ul>
      </section>
    }
  `,
})
export class KeykeeperAdminTwoStepComponent {
  readonly organizationId = input.required<string>();

  protected readonly setting = signal<OrgAdminTwoStep | null>(null);
  protected readonly form = new FormGroup({
    required: new FormControl(false, { nonNullable: true }),
  });
  private readonly myUserId = signal<string | null>(null);
  protected readonly meNotSetUp = computed(() => {
    const me = this.myUserId();
    return me != null && (this.setting()?.notSetUp ?? []).some((p) => p.userId === me);
  });
  protected readonly roleLabel = twoStepRoleLabel;

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly accountService: AccountService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.organizationId();
      // Not an owner or admin: the server says not found, and the card stays hidden.
      this.api.getOrgAdminTwoStep(id).then(
        (s) => this.show(s),
        () => this.setting.set(null),
      );
    });
    void firstValueFrom(this.accountService.activeAccount$.pipe(map((a) => a?.id ?? null))).then(
      (id) => this.myUserId.set(id),
    );
  }

  private show(setting: OrgAdminTwoStep) {
    this.setting.set(setting);
    this.form.controls.required.setValue(setting.required);
  }

  protected readonly save = async () => {
    const current = this.setting();
    const required = this.form.controls.required.value;
    if (current?.required && !required) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: "Turn off two-step login for admins?",
        content:
          "Owners, admins, and custom roles that manage members, policies, or account recovery could then sign in with only a password, or an email code. The change goes in the event log.",
        acceptButtonText: "Turn it off",
        type: "warning",
      });
      if (!confirmed) {
        this.form.controls.required.setValue(true);
        return;
      }
    }
    try {
      this.show(await this.api.setOrgAdminTwoStep(this.organizationId(), required));
      this.toastService.showToast({
        variant: "success",
        message: required ? "Two-step login is required for admins" : "Turned off",
      });
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  };
}
