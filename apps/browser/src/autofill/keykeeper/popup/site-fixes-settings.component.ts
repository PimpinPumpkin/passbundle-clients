import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { RouterModule } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import {
  CardComponent,
  CheckboxModule,
  FormFieldModule,
  LinkModule,
  SectionComponent,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";

import { SHARE_SITE_FIXES } from "../site-fixes";

/**
 * Keykeeper: the Site fixes section of the extension's Autofill settings:
 * sharing the fixes someone makes with the fill picker (off until they turn
 * it on), and reporting a problem with the site in the current tab. See
 * site-fixes.ts and DESIGN.md, "Site fixes (opt-in)".
 */
@Component({
  selector: "app-keykeeper-site-fixes-settings",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    CheckboxModule,
    FormFieldModule,
    LinkModule,
    RouterModule,
    SectionComponent,
    SectionHeaderComponent,
    TypographyModule,
  ],
  template: `
    <bit-section data-testid="site-fixes-settings">
      <bit-section-header>
        <h2 bitTypography="h6">Site fixes</h2>
      </bit-section-header>
      <bit-card>
        <bit-form-control>
          <input
            bitCheckbox
            id="share-site-fixes"
            type="checkbox"
            [checked]="sharing()"
            (change)="setSharing($any($event.target).checked)"
          />
          <bit-label for="share-site-fixes">Share fixes I make with the fill picker</bit-label>
          <bit-hint>
            Sends your server the site, how to find the field, and whether it gets the username,
            password, or code. Never what's in it, and never custom fields. A fix three people share
            fills for everyone on your server.
          </bit-hint>
        </bit-form-control>
        <a bitLink routerLink="/keykeeper-site-problem" data-testid="site-problem-link">
          Report a problem with the site in this tab
        </a>
      </bit-card>
    </bit-section>
  `,
})
export class KeykeeperSiteFixesSettingsComponent implements OnInit {
  protected readonly sharing = signal(false);

  constructor(
    private readonly accountService: AccountService,
    private readonly stateProvider: StateProvider,
  ) {}

  private async state() {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    return this.stateProvider.getUser(userId, SHARE_SITE_FIXES);
  }

  async ngOnInit() {
    this.sharing.set((await firstValueFrom((await this.state()).state$)) === true);
  }

  protected async setSharing(on: boolean) {
    await (await this.state()).update(() => on);
    this.sharing.set(on);
  }
}
