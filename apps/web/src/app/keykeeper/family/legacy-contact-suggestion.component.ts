import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import { BannerModule, LinkModule } from "@bitwarden/components";

import { KeykeeperFamilyLinkService } from "./family-link.service";

/** What the suggestion says, and its two answers. */
export const LEGACY_CONTACT_SUGGESTION = {
  text: "Add a legacy contact: someone you trust who can ask for your vault if something happens to you.",
  add: "Add one",
  noThanks: "No thanks",
} as const;

/**
 * Keykeeper: on the vault page, one line suggesting a legacy contact
 * (upstream's emergency access, in every plan) to an owner of a family. The
 * server decides who sees it: an owner of a family with no legacy contact who
 * hasn't said No thanks, which hides it for good on every device. Nothing
 * shows when the server can't be asked. See DESIGN.md, "A family's invite
 * link" and "Legacy contacts".
 */
@Component({
  selector: "app-keykeeper-legacy-contact-suggestion",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BannerModule, LinkModule, RouterLink],
  template: `
    @if (show()) {
      <bit-banner
        variant="primary"
        icon="bwi-users"
        [useAlertRole]="false"
        data-testid="legacy-contact-suggestion"
      >
        {{ words.text }}
        <a bitLink linkType="secondary" routerLink="/settings/emergency-access">{{ words.add }}</a>
        ·
        <button type="button" bitLink linkType="secondary" (click)="noThanks()">
          {{ words.noThanks }}
        </button>
      </bit-banner>
    }
  `,
})
export class KeykeeperLegacyContactSuggestionComponent implements OnInit {
  protected readonly show = signal(false);
  protected readonly words = LEGACY_CONTACT_SUGGESTION;
  private readonly familyLinks = inject(KeykeeperFamilyLinkService);

  async ngOnInit() {
    this.show.set(await this.familyLinks.legacyContactSuggestion());
  }

  protected async noThanks() {
    this.show.set(false);
    try {
      await this.familyLinks.dismissLegacyContactSuggestion();
    } catch {
      // It shows again the next time the vault opens; nothing waits on it.
    }
  }
}
