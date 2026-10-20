import { ChangeDetectionStrategy, Component } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { RouterLink } from "@angular/router";
import { map } from "rxjs";

import { LinkModule, TypographyModule } from "@bitwarden/components";

import { VaultPopupAutofillService } from "../../../vault/popup/services/vault-popup-autofill.service";

/**
 * Keykeeper: "Report a problem with this site" under the current tab's
 * suggestions. It names the tab, so the report page describes the same site
 * from a popout too. See DESIGN.md, "Site fixes (opt-in)".
 */
@Component({
  selector: "app-keykeeper-site-problem-link",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LinkModule, RouterLink, TypographyModule],
  template: `
    @let id = tabId();
    @if (id != null) {
      <p bitTypography="helper" class="tw-px-1 -tw-mt-3 tw-mb-5 bit-compact:tw-mb-4">
        <a
          bitLink
          routerLink="/keykeeper-site-problem"
          [queryParams]="{ tabId: id }"
          data-testid="current-tab-site-problem-link"
        >
          Not filling right? Report a problem with this site
        </a>
      </p>
    }
  `,
})
export class KeykeeperSiteProblemLinkComponent {
  /** The current tab's id, when it's a website. */
  protected readonly tabId = toSignal(
    this.vaultPopupAutofillService.currentAutofillTab$.pipe(
      map((tab) => (tab?.id != null && /^https?:/.test(tab.url ?? "") ? tab.id : null)),
    ),
    { initialValue: null },
  );

  constructor(private readonly vaultPopupAutofillService: VaultPopupAutofillService) {}
}
