import { ChangeDetectionStrategy, Component } from "@angular/core";
import { Router } from "@angular/router";

import { ImporterProviders, KeykeeperBrowserImportComponent } from "@bitwarden/importer-ui";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

/**
 * Keykeeper: the web vault's page for guided import from a browser (Tools,
 * Import from your browser). A web page can't open the browser's own pages,
 * so the steps say where to go. See DESIGN.md, "Browser import".
 */
@Component({
  selector: "app-keykeeper-browser-import-web",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule, KeykeeperBrowserImportComponent],
  providers: [...ImporterProviders],
  template: `
    <app-header></app-header>
    <bit-container>
      <tools-keykeeper-browser-import (done)="finish()"></tools-keykeeper-browser-import>
    </bit-container>
  `,
})
export class KeykeeperBrowserImportWebComponent {
  constructor(private readonly router: Router) {}

  protected async finish() {
    await this.router.navigate(["vault"]);
  }
}
