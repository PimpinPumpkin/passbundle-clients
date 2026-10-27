import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";

import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { ButtonModule, CalloutModule, DialogService, ToastService } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { replaceTokenPrompt } from "./offboarding";

/**
 * Keykeeper: on an organization's Members page, after someone was removed,
 * the offer to replace its install command's token: whoever was removed may
 * still have the command. They'd wait for an admin to approve them, but a
 * new token stops the old command for good. An MSP's client is told to ask
 * its IT provider, whose console has the same offer. See DESIGN.md,
 * "Offboarding".
 */
@Component({
  selector: "app-keykeeper-install-token-prompt",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule],
  template: `
    @if (prompt(); as p) {
      <bit-callout
        type="warning"
        title="Replace the install command?"
        class="tw-mb-4 tw-block"
        data-testid="install-token-prompt"
      >
        <p class="tw-mb-2">{{ p.text }}</p>
        @if (p.canReplace) {
          <button bitButton buttonType="secondary" type="button" (click)="replace()">
            Replace token
          </button>
        }
      </bit-callout>
    }
  `,
})
export class KeykeeperInstallTokenPromptComponent {
  readonly organization = input.required<Organization>();
  /** The page's member list: a change (such as a removal) checks again. */
  readonly members = input<unknown>(null);

  protected readonly prompt = signal<{ text: string; canReplace: boolean } | null>(null);

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const org = this.organization();
      this.members();
      void this.load(org);
    });
  }

  private async load(org: Organization) {
    if (!(org.isOwner || org.isAdmin)) {
      this.prompt.set(null);
      return;
    }
    try {
      const found = await this.api.getOrgEnrollment(org.id);
      const text =
        "provider" in found
          ? replaceTokenPrompt(found.removedSinceToken, found.provider)
          : replaceTokenPrompt(found.removedSinceToken);
      this.prompt.set(text == null ? null : { text, canReplace: !("provider" in found) });
    } catch {
      // The server answers only owners and admins.
      this.prompt.set(null);
    }
  }

  protected async replace() {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: "Replace the install token?",
      content:
        "Install commands already run on your computers stop letting new people join. Copy the new command from the Settings page and run it there instead.",
      acceptButtonText: "Replace token",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.api.replaceOrgEnrollment(this.organization().id);
      this.toastService.showToast({ variant: "success", message: "Replaced the install token" });
      await this.load(this.organization());
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
