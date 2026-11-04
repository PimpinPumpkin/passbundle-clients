import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { RouterModule } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { StateProvider, UserKeyDefinition } from "@bitwarden/common/platform/state";
import {
  CardComponent,
  CheckboxModule,
  FormFieldModule,
  LinkModule,
  SectionComponent,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";

import { KeykeeperSiteFixes, SHARE_SITE_FIXES, USE_SITE_FIXES } from "../site-fixes";

/**
 * Keykeeper: the Site fixes section of the extension's Autofill settings:
 * using the fixes other people share (on until they turn it off), sharing the
 * fixes someone makes with the fill picker (off until they turn it on), and
 * reporting a problem with the site in the current tab. See site-fixes.ts and
 * DESIGN.md, "Site fixes (opt-in)".
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
            id="use-site-fixes"
            type="checkbox"
            [checked]="using()"
            (change)="setUsing($any($event.target).checked)"
          />
          <bit-label for="use-site-fixes">Use fixes other people share</bit-label>
          <bit-hint>
            Fixes several people on your server sent, and your MSP's, for sites that don't fill
            right. They fill only when you fill, never on their own when a page opens, and a
            password only into a password box.
          </bit-hint>
        </bit-form-control>
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
  protected readonly using = signal(true);

  constructor(
    private readonly accountService: AccountService,
    private readonly stateProvider: StateProvider,
  ) {}

  private async state<T>(definition: UserKeyDefinition<T>) {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    return this.stateProvider.getUser(userId, definition);
  }

  async ngOnInit() {
    this.sharing.set((await firstValueFrom((await this.state(SHARE_SITE_FIXES)).state$)) === true);
    this.using.set((await firstValueFrom((await this.state(USE_SITE_FIXES)).state$)) !== false);
  }

  protected async setSharing(on: boolean) {
    await (await this.state(SHARE_SITE_FIXES)).update(() => on);
    this.sharing.set(on);
  }

  /** Off, the downloaded list goes too; on, it comes down at the next unlock or daily check. */
  protected async setUsing(on: boolean) {
    await (await this.state(USE_SITE_FIXES)).update(() => on);
    this.using.set(on);
    if (!on) {
      await (await this.state(KeykeeperSiteFixes.LIST)).update(() => null);
    }
  }
}
