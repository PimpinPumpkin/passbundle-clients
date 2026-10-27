import { ChangeDetectionStrategy, Component, Inject } from "@angular/core";

import { MspRemoval } from "@bitwarden/admin-console/common";
import { DIALOG_DATA } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { describeMspRemoval } from "./offboarding";

/**
 * Keykeeper: what removing an MSP took out of a client, shown to the owner
 * who removed it: its people, the script and provisioning tokens they made,
 * the event destinations they set up, and its install command, and the
 * single sign-on settings to review. See DESIGN.md, "Offboarding".
 */
@Component({
  selector: "app-keykeeper-msp-removed-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    <bit-dialog [title]="'Removed ' + data.msp.name" data-testid="msp-removed">
      <ng-container bitDialogContent>
        <p bitTypography="body1">{{ said.people }}</p>
        @if (said.removed.length) {
          <p bitTypography="body1" class="tw-mb-1">Also gone, so it stops working now:</p>
          <ul class="tw-mb-3 tw-list-disc tw-ps-5" data-testid="msp-removed-list">
            @for (line of said.removed; track line) {
              <li>{{ line }}</li>
            }
          </ul>
        }
        <p bitTypography="body1">{{ said.installCommand }}</p>
        @if (said.singleSignOn; as sso) {
          <p bitTypography="body1" data-testid="msp-removed-sso">{{ sso }}</p>
        }
      </ng-container>
      <ng-container bitDialogFooter>
        <button bitButton buttonType="primary" type="button" bitDialogClose>Done</button>
      </ng-container>
    </bit-dialog>
  `,
})
export class KeykeeperMspRemovedDialogComponent {
  protected readonly said = describeMspRemoval(this.data);

  constructor(@Inject(DIALOG_DATA) protected readonly data: MspRemoval) {}
}
