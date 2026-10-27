import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";

import { OrgJoining } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { describeJoining, inviteChoices } from "./joining";

/**
 * Keykeeper: how people join this organization, on its Settings page, for
 * owners and admins (the server answers no one else, and the card stays
 * hidden). See DESIGN.md, "Joining".
 */
@Component({
  selector: "app-keykeeper-org-joining",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (joining(); as j) {
      <section data-testid="org-joining">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Joining</h1>
        <p bitTypography="body1">
          When someone accepts an invitation, the web app or browser extension of an owner or admin
          gives them access in the background, usually within a few minutes. It needs one of them
          unlocked: the server never holds this organization's key.
        </p>
        <p bitTypography="body2" data-testid="org-joining-source">
          @switch (j.source) {
            @case ("msp") {
              Follows {{ j.mspName }}'s default.
            }
            @case ("own") {
              This organization's own setting.
              @if (j.mspName || differsFromDefault()) {
                The default: {{ defaultText() }}.
              }
            }
            @default {
              The default.
            }
          }
        </p>
        <form [formGroup]="form" [bitSubmit]="save" aria-label="Joining">
          <bit-form-control>
            <input type="checkbox" bitCheckbox formControlName="autoConfirm" />
            <bit-label>Let people in when they accept an invitation</bit-label>
            <bit-hint
              >Off: they wait until an owner or admin confirms them on the Members page.</bit-hint
            >
          </bit-form-control>
          <bit-form-field class="tw-max-w-xs">
            <bit-label>Invitations expire after</bit-label>
            <select bitInput formControlName="inviteHours">
              @for (c of choices(); track c.hours) {
                <option [ngValue]="c.hours">{{ c.label }}</option>
              }
            </select>
          </bit-form-field>
          <div class="tw-flex tw-gap-2">
            <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
            @if (j.source === "own" && (j.mspName || differsFromDefault())) {
              <button
                bitButton
                bitFormButton
                buttonType="secondary"
                type="button"
                [bitAction]="useDefault"
              >
                {{ j.mspName ? "Use " + j.mspName + "'s default" : "Use the default" }}
              </button>
            }
          </div>
        </form>
      </section>
    }
  `,
})
export class KeykeeperOrgJoiningComponent {
  readonly organizationId = input.required<string>();

  protected readonly joining = signal<OrgJoining | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    autoConfirm: true,
    inviteHours: 120,
  });
  protected readonly choices = computed(() => inviteChoices(this.joining()?.inviteHours ?? 120));
  protected readonly defaultText = computed(() => {
    const d = this.joining()?.default;
    return d ? describeJoining(d).toLowerCase() : "";
  });
  protected readonly differsFromDefault = computed(() => {
    const j = this.joining();
    return (
      j != null &&
      (j.autoConfirm !== j.default.autoConfirm || j.inviteHours !== j.default.inviteHours)
    );
  });

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperMspApiService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.organizationId();
      // Not an owner or admin: the server says not found, and the card stays hidden.
      this.api.getOrgJoining(id).then(
        (j) => this.show(j),
        () => this.joining.set(null),
      );
    });
  }

  private show(joining: OrgJoining) {
    this.joining.set(joining);
    this.form.setValue({ autoConfirm: joining.autoConfirm, inviteHours: joining.inviteHours });
  }

  protected readonly save = async () => {
    try {
      this.show(await this.api.setOrgJoining(this.organizationId(), this.form.getRawValue()));
      this.toastService.showToast({ variant: "success", message: "Saved how people join" });
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  };

  protected readonly useDefault = async () => {
    const seen = this.joining();
    if (seen == null) {
      return;
    }
    this.show(await this.api.useDefaultJoining(this.organizationId(), seen.default.autoConfirm));
    this.toastService.showToast({ variant: "success", message: "Back on the default" });
  };
}
