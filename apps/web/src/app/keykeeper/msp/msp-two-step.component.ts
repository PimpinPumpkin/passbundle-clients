import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";
import { firstValueFrom, map } from "rxjs";

import { MspTwoStep } from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { twoStepRoleLabel } from "../organizations/admin-two-step.component";

import { KeykeeperMspApiService } from "./msp-api.service";

/**
 * Keykeeper: two-step login in the MSP console. Whether everyone on the
 * MSP's staff must use it (MSP admins change it), who on the staff hasn't set
 * it up, and each client's own admins who haven't where the client requires
 * it. Each client's setting is one of the default policies ("Two-step login
 * for admins"). See DESIGN.md, "Two-step login for admins".
 */
@Component({
  selector: "app-keykeeper-msp-two-step",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (view(); as v) {
      <section class="tw-mt-8" data-testid="msp-two-step">
        <h2 bitTypography="h3">Two-step login</h2>
        <p bitTypography="body2">
          Your staff reach every client they work in, so they sign in with an authenticator app, a
          security key or passkey, or Duo. Email codes don't count. Anyone without one sets it up
          the next time they sign in, before anything else. Each client's admins follow the default
          policy "Two-step login for admins".
        </p>
        @if (meNotSetUp()) {
          <bit-callout type="warning" [title]="null" data-testid="msp-two-step-you">
            You haven't set up two-step login.
            @if (v.staffRequired) {
              You'll be asked to the next time you sign in.
            }
            <a bitLink routerLink="/settings/security/two-factor">Set it up now</a>
          </bit-callout>
        }
        @if (isAdmin()) {
          <form [formGroup]="form" [bitSubmit]="save" aria-label="Two-step login for staff">
            <bit-form-control>
              <input type="checkbox" bitCheckbox formControlName="staffRequired" />
              <bit-label>Require two-step login for everyone on the staff</bit-label>
            </bit-form-control>
            <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
          </form>
        } @else {
          <p bitTypography="body2" data-testid="msp-two-step-staff-state">
            {{
              v.staffRequired
                ? "Required for everyone on the staff."
                : "Not required for the staff."
            }}
          </p>
        }
        <h3 bitTypography="h5" class="tw-mt-4">Staff without it</h3>
        <ul class="tw-list-none tw-pl-0" data-testid="msp-two-step-staff">
          @for (p of v.staffNotSetUp; track p.userId) {
            <li class="tw-py-1">
              <span class="tw-font-semibold">{{ p.name || p.email }}</span>
              @if (p.name) {
                <span class="tw-text-muted"> {{ p.email }}</span>
              }
              <span class="tw-text-muted"> · {{ roleLabel(p) }}</span>
            </li>
          } @empty {
            <li class="tw-text-muted">Everyone on the staff has set it up.</li>
          }
        </ul>
        <h3 bitTypography="h5" class="tw-mt-4">Clients' admins without it</h3>
        <ul class="tw-list-none tw-pl-0" data-testid="msp-two-step-clients">
          @for (c of clientsNotSetUp(); track c.id) {
            <li class="tw-py-1" [attr.data-testid]="'msp-two-step-client-' + c.name">
              <span class="tw-font-semibold">{{ c.name }}</span>
              @if (!c.required) {
                <span class="tw-text-muted"> (doesn't require it)</span>
              }
              :
              @for (p of c.notSetUp; track p.userId; let last = $last) {
                {{ p.name || p.email }} ({{ roleLabel(p) | lowercase }}){{ last ? "" : ", " }}
              }
            </li>
          } @empty {
            <li class="tw-text-muted">Every client's admins have set it up.</li>
          }
        </ul>
      </section>
    }
  `,
})
export class KeykeeperMspTwoStepComponent {
  readonly mspId = input.required<string>();
  readonly isAdmin = input.required<boolean>();
  /** The setting changed. */
  readonly changed = output<void>();

  protected readonly view = signal<MspTwoStep | null>(null);
  protected readonly form = new FormGroup({
    staffRequired: new FormControl(true, { nonNullable: true }),
  });
  private readonly myUserId = signal<string | null>(null);
  protected readonly meNotSetUp = computed(() => {
    const me = this.myUserId();
    return me != null && (this.view()?.staffNotSetUp ?? []).some((p) => p.userId === me);
  });
  protected readonly clientsNotSetUp = computed(() =>
    (this.view()?.clients ?? []).filter((c) => c.notSetUp.length > 0),
  );
  protected readonly roleLabel = twoStepRoleLabel;

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly accountService: AccountService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.mspId();
      this.api.getMspTwoStep(id).then(
        (v) => this.show(v),
        () => this.view.set(null),
      );
    });
    void firstValueFrom(this.accountService.activeAccount$.pipe(map((a) => a?.id ?? null))).then(
      (id) => this.myUserId.set(id),
    );
  }

  private show(view: MspTwoStep) {
    this.view.set(view);
    this.form.controls.staffRequired.setValue(view.staffRequired);
  }

  protected readonly save = async () => {
    const required = this.form.controls.staffRequired.value;
    if (this.view()?.staffRequired && !required) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: "Stop requiring two-step login of your staff?",
        content:
          "Your staff could then sign in with only a password, or an email code, and reach every client they work in. A client that requires two-step login for its admins still requires it of your staff there. The change goes in the activity log.",
        acceptButtonText: "Stop requiring it",
        type: "warning",
      });
      if (!confirmed) {
        this.form.controls.staffRequired.setValue(true);
        return;
      }
    }
    try {
      this.show(await this.api.setMspStaffTwoStep(this.mspId(), required));
      this.toastService.showToast({
        variant: "success",
        message: required ? "Your staff must use two-step login" : "Turned off for your staff",
      });
      this.changed.emit();
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  };
}
