import { ChangeDetectionStrategy, Component } from "@angular/core";
import { Router } from "@angular/router";

import { ImporterProviders, KeykeeperBrowserImportComponent } from "@bitwarden/importer-ui";

import { BrowserApi } from "../../platform/browser/browser-api";
import { PopOutComponent } from "../../platform/popup/components/pop-out.component";
import { PopupHeaderComponent } from "../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../platform/popup/layout/popup-page.component";

/**
 * Keykeeper: guided import from the browser the extension runs in. Opens in
 * its own window, like upstream's import, since a file picker closes the
 * popup; and it can open a Chromium browser's own passwords page, which a
 * web page can't. See DESIGN.md, "Browser import".
 */
@Component({
  selector: "app-keykeeper-browser-import-page",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PopupPageComponent,
    PopupHeaderComponent,
    PopOutComponent,
    KeykeeperBrowserImportComponent,
  ],
  providers: [...ImporterProviders],
  template: `
    <popup-page>
      <popup-header slot="header" pageTitle="Import from your browser" showBackButton>
        <ng-container slot="end">
          <app-pop-out></app-pop-out>
        </ng-container>
      </popup-header>
      <div class="tw-px-1 tw-py-2">
        <tools-keykeeper-browser-import
          [openPasswordsPage]="openPasswordsPage"
          (done)="finish()"
        ></tools-keykeeper-browser-import>
      </div>
    </popup-page>
  `,
})
export class KeykeeperBrowserImportPageComponent {
  protected readonly openPasswordsPage = (url: string) => {
    void BrowserApi.createNewTab(url, true);
  };

  constructor(private readonly router: Router) {}

  protected async finish() {
    await this.router.navigate(["/tabs/vault"]);
  }
}
