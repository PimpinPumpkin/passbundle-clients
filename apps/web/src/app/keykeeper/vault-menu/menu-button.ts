import { inject, InjectionToken } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router } from "@angular/router";
import { distinctUntilChanged, filter, map } from "rxjs";

import { SideNavService } from "@bitwarden/components";

/**
 * Keykeeper: provided by a layout whose pages' headers show a menu button
 * where the side nav has no room to show at all (a phone's width). Upstream
 * has no way to open the menu there; the user layout's pages need one, since
 * the vault's filters are in it, and so do the admin console's, whose pages
 * are only in its menu. See DESIGN.md, "The left menu".
 */
export const KEYKEEPER_MENU_BUTTON = new InjectionToken<boolean>("KeykeeperMenuButton");

/**
 * Keykeeper: where the menu covers the page (a phone), going to another page
 * closes it; a change to the address's query alone (a search typed in the
 * vault's menu) doesn't. For a layout that provides KEYKEEPER_MENU_BUTTON,
 * called from its constructor.
 */
export function closeMenuOverPageOnNewPage(): void {
  const router = inject(Router);
  const sideNav = inject(SideNavService);
  router.events
    .pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => router.url.split(/[?#]/)[0]),
      distinctUntilChanged(),
      takeUntilDestroyed(),
    )
    .subscribe(() => {
      if (sideNav.isOverlay()) {
        sideNav.open.set(false);
      }
    });
}
