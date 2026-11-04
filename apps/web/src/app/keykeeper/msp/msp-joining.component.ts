import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from "@angular/core";
import { FormBuilder } from "@angular/forms";

import { MspJoining } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { describeJoining, inviteChoices } from "../joining/joining";

import { KeykeeperMspApiService } from "./msp-api.service";

/**
 * Keykeeper: how people join the MSP's clients, in the console. The MSP's
 * default applies to every client without its own setting; a client's owners
 * or admins can set their own on its Settings page, and an MSP admin can put
 * it back on the default here. See DESIGN.md, "Joining".
 */
@Component({
  selector: "app-keykeeper-msp-joining",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (joining(); as j) {
      <section class="tw-mt-8" data-testid="msp-joining">
        <h2 bitTypography="h3">Joining</h2>
        <p bitTypography="body2">
          When someone accepts an invitation to a client, the web app or browser extension of anyone
          here who can confirm them gives them access in the background, usually within a few
          minutes. The default for every client: {{ describe(j.default) }}.
        </p>
        @if (isAdmin()) {
          <form
            [formGroup]="form"
            [bitSubmit]="save"
            aria-label="Joining default"
            class="tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
          >
            <bit-form-control>
              <input type="checkbox" bitCheckbox formControlName="autoConfirm" />
              <bit-label>Let people in when they accept an invitation</bit-label>
              <bit-hint>Off: they wait until someone confirms them.</bit-hint>
            </bit-form-control>
            <bit-form-field class="tw-max-w-xs">
              <bit-label>Invitations expire after</bit-label>
              <select bitInput formControlName="inviteHours">
                @for (c of choices(); track c.hours) {
                  <option [ngValue]="c.hours">{{ c.label }}</option>
                }
              </select>
            </bit-form-field>
            <button bitButton bitFormButton buttonType="primary" type="submit">Save default</button>
          </form>
        }
        @if (j.ownSettings.length > 0) {
          <h3 bitTypography="h5" class="tw-mt-4">Clients with their own setting</h3>
          <ul class="tw-list-none tw-pl-0">
            @for (client of j.ownSettings; track client.organizationId) {
              <li
                class="tw-flex tw-items-center tw-gap-2 tw-py-1"
                [attr.data-testid]="'msp-joining-' + client.name"
              >
                <span>{{ client.name }}: {{ describe(client) }}</span>
                @if (isAdmin()) {
                  <button
                    type="button"
                    bitButton
                    buttonType="secondary"
                    size="small"
                    [bitAction]="useDefaultFor(client.organizationId, client.name)"
                    [attr.aria-label]="'Use the default for ' + client.name"
                  >
                    Use default
                  </button>
                }
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class KeykeeperMspJoiningComponent {
  readonly mspId = input.required<string>();
  readonly isAdmin = input.required<boolean>();
  readonly changed = output<void>();

  protected readonly joining = signal<MspJoining | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    autoConfirm: true,
    inviteHours: 120,
  });
  protected readonly choices = computed(() =>
    inviteChoices(this.joining()?.default.inviteHours ?? 120),
  );
  protected readonly describe = describeJoining;

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperMspApiService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      void this.load(this.mspId());
    });
  }

  private async load(mspId: string) {
    this.show(await this.api.getMspJoining(mspId));
  }

  private show(joining: MspJoining) {
    this.joining.set(joining);
    this.form.setValue({
      autoConfirm: joining.default.autoConfirm,
      inviteHours: joining.default.inviteHours,
    });
  }

  protected readonly save = async () => {
    const seen = this.joining();
    if (seen == null) {
      return;
    }
    try {
      this.show(await this.api.saveMspJoining(this.mspId(), this.form.getRawValue(), seen.default));
      this.toastService.showToast({ variant: "success", message: "Saved the joining default" });
      this.changed.emit();
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  };

  protected useDefaultFor(organizationId: string, name: string) {
    return async () => {
      const seen = this.joining();
      if (seen == null) {
        return;
      }
      await this.api.useDefaultJoining(organizationId, seen.default.autoConfirm, this.mspId());
      await this.load(this.mspId());
      this.toastService.showToast({ variant: "success", message: `${name} uses the default` });
      this.changed.emit();
    };
  }
}
