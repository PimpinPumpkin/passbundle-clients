// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, inject, Input } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import {
  CardComponent,
  FormFieldModule,
  IconButtonModule,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";

import { KeykeeperOpenAndFillService } from "../../keykeeper/open-and-fill.service";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-autofill-options-view",
  templateUrl: "autofill-options-view.component.html",
  imports: [
    CommonModule,
    JslibModule,
    CardComponent,
    SectionHeaderComponent,
    TypographyModule,
    FormFieldModule,
    IconButtonModule,
  ],
})
export class AutofillOptionsViewComponent {
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() loginUris: LoginUriView[];
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() cipherId: string;

  /** Keykeeper: "Open and fill", where the app has it (the extension). */
  private openAndFillService = inject(KeykeeperOpenAndFillService, { optional: true });

  constructor(
    private platformUtilsService: PlatformUtilsService,
    private cipherService: CipherService,
    private accountService: AccountService,
  ) {}

  async openWebsite(selectedUri: string) {
    const activeUserId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    await this.cipherService.updateLastLaunchedDate(this.cipherId, activeUserId);
    this.platformUtilsService.launchUri(selectedUri);
  }

  /**
   * Keykeeper: the address "Open and fill" opens for a website, or null when
   * it only opens (DESIGN.md, "Open and fill").
   */
  openAndFillUrl(login: LoginUriView): string | null {
    return this.openAndFillService?.urlFor(login) ?? null;
  }

  /**
   * Keykeeper: opens the website and fills that tab once. The item view
   * opened after the master password prompt, for an item that asks for it,
   * as upstream's Fill button there assumes.
   */
  async openAndFillWebsite(login: LoginUriView) {
    const url = this.openAndFillUrl(login);
    if (url == null || this.openAndFillService == null) {
      return;
    }
    const activeUserId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    await this.cipherService.updateLastLaunchedDate(this.cipherId, activeUserId);
    await this.openAndFillService.open(this.cipherId, url);
  }
}
