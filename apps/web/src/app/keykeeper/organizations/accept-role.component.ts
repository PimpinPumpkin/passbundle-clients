import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";

import { UnacceptedRole } from "@bitwarden/admin-console/common";
import { ButtonModule, CalloutModule, ToastService } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: on the vault page, each role an organization gave this person
 * on a server that sends no email, which joined them without asking, where
 * the organization requires two-step login for it. Two-step login for admins
 * doesn't count the role until they accept it here; accepting without a
 * method that counts signs them out, to set one up as they sign in again.
 * Nothing shows otherwise. See DESIGN.md, "Two-step login for admins".
 */
@Component({
  selector: "app-keykeeper-accept-role",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule],
  template: `
    @for (role of roles(); track role.organizationId) {
      <bit-callout
        type="info"
        [title]="'Accept your role in ' + role.name"
        class="tw-mb-4 tw-block"
        data-testid="accept-role"
      >
        <p class="tw-mb-2">
          {{ role.name }} made you {{ roleWords(role) }}, which requires two-step login. Accept the
          role to take it on. If you haven't set up two-step login, accepting signs you out, and you
          set it up as you sign in again.
        </p>
        <button
          bitButton
          buttonType="primary"
          type="button"
          [disabled]="busy()"
          (click)="accept(role)"
        >
          Accept the role
        </button>
      </bit-callout>
    }
  `,
})
export class KeykeeperAcceptRoleComponent implements OnInit {
  private readonly api = inject(KeykeeperMspApiService);
  private readonly toastService = inject(ToastService);

  protected readonly roles = signal<UnacceptedRole[]>([]);
  protected readonly busy = signal(false);

  async ngOnInit() {
    this.roles.set(await this.api.unacceptedRoles());
  }

  protected roleWords(role: UnacceptedRole): string {
    switch (role.role) {
      case "owner":
        return "an owner";
      case "admin":
        return "an admin";
      default:
        return "a custom role";
    }
  }

  protected async accept(role: UnacceptedRole) {
    this.busy.set(true);
    try {
      await this.api.acceptRole(role.organizationId);
      this.roles.update((all) => all.filter((r) => r.organizationId !== role.organizationId));
      this.toastService.showToast({
        variant: "success",
        message: `Accepted your role in ${role.name}`,
      });
    } finally {
      this.busy.set(false);
    }
  }
}
