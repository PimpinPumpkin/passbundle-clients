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

import { ClientMsp, KeykeeperMspApiService } from "./msp-api.service";
import { describeStaffRole } from "./technician-access";

/**
 * Keykeeper: on a client organization's Members page, which MSP manages it,
 * who its staff are, and what each can do there (their role, a custom role's
 * permissions, and whether they see vault items). The client's own owners can
 * remove the MSP, which takes all of its staff out of the organization at once.
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
      content: `${name}'s staff lose access to this organization right away. To work with ${name} again, they'll need to add you as a client again.`,
      acceptButtonText: `Remove ${name}`,
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.mspApi.removeOrganizationMsp(this.organization().id);
      this.info.set(null);
      this.toastService.showToast({ variant: "success", message: `Removed ${name}` });
      this.removed.emit();
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
