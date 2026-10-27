import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from "@angular/core";

import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { ButtonModule, CalloutModule, DialogService, ToastService } from "@bitwarden/components";

import { KeykeeperMspRemovedDialogComponent } from "../offboarding/msp-removed-dialog.component";

import { ClientMsp, KeykeeperMspApiService } from "./msp-api.service";
import { describeStaffRole } from "./technician-access";

/**
 * Keykeeper: on a client organization's Members page, which MSP manages it,
 * who its staff are, and what each can do there (their role, a custom role's
 * permissions, and whether they see vault items). The client's own owners can
 * remove the MSP, which takes all of its staff out of the organization at once,
 * with what they made there, and then says what went.
 */
@Component({
  selector: "app-keykeeper-client-msp-banner",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule],
  template: `
    @if (info()?.msp; as msp) {
      <bit-callout type="info" [title]="null" data-testid="client-msp">
        <p class="tw-mb-2">{{ msp.name }} manages this organization. Its staff here:</p>
        <ul class="tw-mb-2 tw-ps-5 tw-list-disc">
          @for (person of staff(); track person.memberId) {
            <li data-testid="client-msp-staff">{{ person.line }}</li>
          }
        </ul>
        @if (canRemove()) {
          <button bitButton buttonType="danger" type="button" (click)="remove(msp.name)">
            Remove {{ msp.name }}
          </button>
        }
      </bit-callout>
    }
  `,
})
export class KeykeeperClientMspBannerComponent {
  readonly organization = input.required<Organization>();
  /** The page's member list: a change, such as a removal, reads the MSP's people again. */
  readonly members = input<unknown>(null);
  /** The MSP was removed, so the member list has changed. */
  readonly removed = output<void>();

  protected readonly info = signal<ClientMsp | null>(null);

  /** Each of the MSP's people, with their role here and whether they see vault items. */
  protected readonly staff = computed(() =>
    (this.info()?.staff ?? []).map((s) => {
      const who = s.name ? `${s.name} (${s.email})` : s.email;
      const role = describeStaffRole(s, (key) => this.i18nService.t(key));
      return { memberId: s.memberId, line: role == null ? who : `${who}: ${role}` };
    }),
  );

  /** The client's own owners, never the MSP's staff. */
  protected readonly canRemove = computed(() => {
    const org = this.organization();
    const staffIds = (this.info()?.staff ?? []).map((s) => s.memberId);
    return org.isOwner && !staffIds.includes(org.organizationUserId);
  });

  constructor(
    private readonly mspApi: KeykeeperMspApiService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
    private readonly i18nService: I18nService,
  ) {
    effect(() => {
      const org = this.organization();
      // Keykeeper: a change to the page's member list (someone removed) reads it again.
      this.members();
      if (org.isOwner || org.isAdmin) {
        this.mspApi.getOrganizationMsp(org.id).then(
          (info) => this.info.set(info),
          // Not shown to anyone the server won't tell.
          () => this.info.set(null),
        );
      }
    });
  }

  protected async remove(name: string) {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Remove ${name}?`,
      content: `${name}'s staff lose access to this organization right away, and so does what they made here: script and provisioning tokens, event destinations, and ${name}'s install command. To work with ${name} again, they'll need to add you as a client again.`,
      acceptButtonText: `Remove ${name}`,
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    try {
      const removal = await this.mspApi.removeOrganizationMsp(this.organization().id);
      this.info.set(null);
      this.removed.emit();
      // Keykeeper: what went with it, and what to review (DESIGN.md, "Offboarding").
      this.dialogService.open(KeykeeperMspRemovedDialogComponent, { data: removal });
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
