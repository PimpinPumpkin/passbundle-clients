import { ChangeDetectionStrategy, Component } from "@angular/core";

import { BadgeModule, CalloutModule } from "@bitwarden/components";

/** The badge's words, beside the name of a member provisioning manages. */
export const FROM_ENTRA = "From Microsoft Entra ID";

/** What the badge's tooltip says: where to change them. */
export const FROM_ENTRA_TOOLTIP =
  "Microsoft Entra ID manages this member: to turn them off, remove them, or change their groups from Entra ID, do it in Entra ID.";

/**
 * What the member dialog says about such a member: which of their details
 * Entra ID changes, so a change here would be undone there, and what's set
 * here. Their name and email are their account's, never the directory's.
 */
export const FROM_ENTRA_NOTE =
  "Microsoft Entra ID turns this member off and removes them when they leave, and sets which of its groups they're in, so change those in Entra ID: its next change to one of its groups overwrites changes made to it here. Their role and shared folders are set here.";

/**
 * Keykeeper: the badge the Members list and the member dialog show beside a
 * member whom provisioning (Microsoft Entra ID, over SCIM) manages, where
 * upstream shows its own badges, so an admin knows to change them in Entra
 * ID. The server says who with `keykeeperProvisioned` on each member. An
 * MSP reaches a client's members through its admin console, so this is what
 * the MSP console shows too. See DESIGN.md, "Provisioning from Entra ID".
 */
@Component({
  selector: "app-keykeeper-from-entra-badge",
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The badge brings its own tooltip (bitTooltip).
  imports: [BadgeModule],
  template: `
    <span
      bitBadge
      class="tw-text-xs"
      variant="secondary"
      startIcon="bwi-info"
      data-testid="member-from-entra"
      [bitTooltip]="tooltip"
      [addTooltipToDescribedby]="true"
      tooltipPosition="below-center"
    >
      {{ label }}
    </span>
  `,
})
export class KeykeeperFromEntraBadgeComponent {
  protected readonly label = FROM_ENTRA;
  protected readonly tooltip = FROM_ENTRA_TOOLTIP;
}

/**
 * Keykeeper: in the member dialog's Details, what Microsoft Entra ID manages
 * for this member and so can't be changed for good here.
 */
@Component({
  selector: "app-keykeeper-from-entra-note",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalloutModule],
  template: `
    <bit-callout type="info" [title]="title" data-testid="member-from-entra-note">
      {{ note }}
    </bit-callout>
  `,
})
export class KeykeeperFromEntraNoteComponent {
  protected readonly title = FROM_ENTRA;
  protected readonly note = FROM_ENTRA_NOTE;
}
