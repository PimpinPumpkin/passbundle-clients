import { InjectionToken } from "@angular/core";

/**
 * Keykeeper: provided by a layout whose pages' headers show a menu button
 * where the side nav has no room to show at all (a phone's width). Upstream
 * has no way to open the menu there; the user layout's pages need one, since
 * the vault's filters are in it. See DESIGN.md, "The left menu".
 */
export const KEYKEEPER_MENU_BUTTON = new InjectionToken<boolean>("KeykeeperMenuButton");
