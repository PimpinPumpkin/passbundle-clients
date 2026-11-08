import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormControl, FormGroup } from "@angular/forms";
import { firstValueFrom, map } from "rxjs";

import { OrgAdminTwoStep, TwoStepNotSetUp } from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperConfirmChangeService } from "../confirm-change/confirm-change.service";
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
    case "member":
      return "Member";
    default:
      return "Custom role";
  }
}

/** "1 member" or "3 members". */
export function membersPhrase(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/**
 * Keykeeper: two-step login for this organization's admins, and for everyone
 * else too, on its Settings page, for owners and admins (and its MSP's
 * admins); the server answers no one else, and the card stays hidden. Shows
 * who it covers (or would) that hasn't set up a method that counts. See
 * DESIGN.md, "Two-step login for admins" and "Two-step login for everyone".
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
        @if (s.msp && s.requiredByMsp) {
          <p bitTypography="body2" data-testid="admin-two-step-msp">
            <span bitBadge variant="primary" startIcon="bwi-lock" [truncate]="false"
              >Required by {{ s.msp.name }}</span
            >
            {{ s.msp.name }} requires this for every client, so only {{ s.msp.name }}'s console
            changes it.
          </p>
        } @else if (s.msp) {
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
          <bit-form-control class="tw-ml-6">
            <input type="checkbox" bitCheckbox formControlName="everyone" />
            <bit-label>Everyone else too</bit-label>
            <bit-hint>
              Every member, whatever their role, with the same methods. Members without one are
              signed out, and set it up the next time they sign in.
            </bit-hint>
          </bit-form-control>
          @if (!s.requiredByMsp) {
            <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
          }
        </form>
        <p bitTypography="body2" class="tw-mt-2" data-testid="admin-two-step-upstream">
          Require two-step login is a separate policy: it counts email codes, and removes members
          who have no two-step login from the organization.
        </p>
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
        @if (s.membersNotSetUp; as members) {
          <h3 bitTypography="h5" class="tw-mt-4">Other members without it</h3>
          @if (!s.everyone && members.length > 0) {
            <p bitTypography="body2" class="tw-text-muted">
              Requiring it of everyone would sign out {{ membersWords(members.length) }} until they
              set it up.
            </p>
          }
          <ul class="tw-list-none tw-pl-0" data-testid="admin-two-step-members-not-set-up">
            @for (p of members; track p.userId) {
              <li class="tw-py-1">
                <span class="tw-font-semibold">{{ p.name || p.email }}</span>
                @if (p.name) {
                  <span class="tw-text-muted"> {{ p.email }}</span>
                }
                @if (p.singleSignOn) {
                  <span class="tw-text-muted">
                    · covered when they sign in with single sign-on, not with a password</span
                  >
                }
              </li>
            } @empty {
              <li class="tw-text-muted">Every other member has set it up.</li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class KeykeeperAdminTwoStepComponent {
  readonly organizationId = input.required<string>();

  protected readonly setting = signal<OrgAdminTwoStep | null>(null);
  protected readonly form = new FormGroup({
    required: new FormControl(false, { nonNullable: true }),
    everyone: new FormControl(false, { nonNullable: true }),
  });
  private readonly myUserId = signal<string | null>(null);
  protected readonly meNotSetUp = computed(() => {
    const me = this.myUserId();
    return me != null && (this.setting()?.notSetUp ?? []).some((p) => p.userId === me);
  });
  protected readonly roleLabel = twoStepRoleLabel;
  protected readonly membersWords = membersPhrase;

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly accountService: AccountService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
    private readonly confirmChange: KeykeeperConfirmChangeService,
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
    // Everyone else needs the admins: without them, it's off and can't be ticked.
    this.form.controls.required.valueChanges
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.syncEveryone());
  }

  private show(setting: OrgAdminTwoStep) {
    this.setting.set(setting);
    this.form.controls.required.setValue(setting.required, { emitEvent: false });
    this.form.controls.everyone.setValue(setting.required && setting.everyone === true);
    // Keykeeper: the MSP requires it for every client, so it's not this page's to change.
    if (setting.requiredByMsp) {
      this.form.controls.required.disable({ emitEvent: false });
    } else {
      this.form.controls.required.enable({ emitEvent: false });
    }
    this.syncEveryone();
  }

  /** Everyone else is on only with the admins, and changes only where the admins can. */
  private syncEveryone() {
    const everyone = this.form.controls.everyone;
    if (!this.form.controls.required.value) {
      everyone.setValue(false);
    }
    if (this.form.controls.required.value && !this.setting()?.requiredByMsp) {
      everyone.enable({ emitEvent: false });
    } else {
      everyone.disable({ emitEvent: false });
    }
  }

  /** What the person asked to warn about first, if anything, before saving. */
  private async confirmed(current: OrgAdminTwoStep | null, required: boolean, everyone: boolean) {
    if (current?.required && !required) {
      return this.dialogService.openSimpleDialog({
        title: "Turn off two-step login for admins?",
        content:
          "Owners, admins, and custom roles that manage members, policies, or account recovery could then sign in with only a password, or an email code." +
          (current.everyone ? " So could everyone else." : "") +
          " The change goes in the event log.",
        acceptButtonText: "Turn it off",
        type: "warning",
      });
    }
    if (current?.everyone && !everyone) {
      return this.dialogService.openSimpleDialog({
        title: "Stop requiring two-step login of everyone?",
        content:
          "Members who aren't admins could then sign in with only a password, or an email code. The change goes in the event log.",
        acceptButtonText: "Stop requiring it",
        type: "warning",
      });
    }
    if (everyone && !current?.everyone) {
      const waiting = current?.membersNotSetUp?.length ?? 0;
      return this.dialogService.openSimpleDialog({
        title: "Require two-step login of everyone?",
        content:
          "Every member must use an authenticator app, a security key or passkey, or Duo. " +
          (waiting > 0
            ? `${membersPhrase(waiting)} without one ${waiting === 1 ? "is" : "are"} signed out now, and set it up the next time they sign in.`
            : "Anyone without one is signed out, and sets it up the next time they sign in."),
        acceptButtonText: "Require it",
        type: "warning",
      });
    }
    return true;
  }

  protected readonly save = async () => {
    const current = this.setting();
    const required = this.form.controls.required.value;
    const everyone = required && this.form.controls.everyone.value;
    if (!(await this.confirmed(current, required, everyone))) {
      if (current != null) {
        this.show(current);
      }
      return;
    }
    try {
      // Keykeeper: the person confirms it's them first (DESIGN.md,
      // "Confirming sensitive changes"); cancelling changes nothing.
      const orgId = this.organizationId();
      const saved = await this.confirmChange.send("keykeeperConfirmAdminTwoStep", (verification) =>
        this.api.setOrgAdminTwoStep(orgId, required, verification, everyone),
      );
      if (saved == null) {
        if (current != null) {
          this.show(current);
        }
        return;
      }
      this.show(saved);
      this.toastService.showToast({
        variant: "success",
        message: everyone
          ? "Two-step login is required of everyone"
          : required
            ? "Two-step login is required for admins"
            : "Turned off",
      });
    } catch (e) {
      const message = plainErrorMessage(e);
      this.toastService.showToast({ variant: "error", message });
    }
  };
}
