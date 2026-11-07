import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { map, Observable } from "rxjs";

import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import {
  BannerModule,
  BitwardenIcon,
  HeaderComponent,
  HeaderContext,
  IconButtonModule,
  SideNavService,
} from "@bitwarden/components";
import { safeProvider } from "@bitwarden/ui-common";

import { KEYKEEPER_MENU_BUTTON } from "../../keykeeper/vault-menu/menu-button";
import { SharedModule } from "../../shared";
import { ProductSwitcherModule } from "../product-switcher/product-switcher.module";

import { AccountMenuComponent } from "./account-menu.component";

@Component({
  selector: "app-header",
  templateUrl: "./web-header.component.html",
  imports: [
    SharedModule,
    ProductSwitcherModule,
    BannerModule,
    HeaderComponent,
    AccountMenuComponent,
    IconButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Keykeeper: the menu button shows only below the width where the side nav's
  // icons fit (its 4rem beside the page's 24rem; see bit-layout), and there
  // the product switcher, which the menu has too, makes room for the title.
  styles: `
    @media (min-width: 28rem) {
      .keykeeper-menu-button {
        display: none !important;
      }
    }
    @media not all and (min-width: 28rem) {
      .keykeeper-phone-hidden {
        display: none !important;
      }
    }
  `,
  /**
   * Required to provide one HeaderContext instance to both the `bit-breadrumbs` declared in this
   * template and the `bit-header`
   */
  providers: [safeProvider(HeaderContext)],
})
export class WebHeaderComponent {
  private readonly route = inject(ActivatedRoute);
  /** Keykeeper: the side nav, when this page's layout wants a menu button on a phone. */
  protected readonly menuNav = inject(KEYKEEPER_MENU_BUTTON, { optional: true })
    ? inject(SideNavService)
    : null;

  protected readonly vfo1Enabled = toSignal(
    inject(ConfigService).getFeatureFlag$(FeatureFlag.VFO1Foundation),
    { initialValue: false },
  );

  /**
   * Custom title that overrides the route data `titleId`
   */
  readonly title = input<string>();

  /**
   * Icon to show before the title
   */
  readonly icon = input<BitwardenIcon>();

  protected readonly routeData$: Observable<{ titleId: string }> = this.route.data.pipe(
    map((params) => {
      return {
        titleId: params.titleId,
      };
    }),
  );
}
