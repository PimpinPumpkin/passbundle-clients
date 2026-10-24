import { Injectable } from "@angular/core";
import { Subscription } from "rxjs";

import { AngularThemingService } from "@bitwarden/angular/platform/services/theming/angular-theming.service";
import { ThemeTypes } from "@bitwarden/common/platform/enums";

/**
 * Keykeeper: the extension's popup has no Glass. Its look is a calm, solid
 * ground with cards on it in every theme (DESIGN.md, "The look"), so System
 * is light or dark like the device, as upstream has it, and the page never
 * gets `pb-glass`, which the web vault's theming sets for System.
 */
@Injectable()
export class KeykeeperPopupThemingService extends AngularThemingService {
  override applyThemeChangesTo(document: Document): Subscription {
    return this.theme$.subscribe((theme) => {
      document.documentElement.classList.remove(
        "theme_" + ThemeTypes.Light,
        "theme_" + ThemeTypes.Dark,
        "pb-glass",
      );
      document.documentElement.classList.add("theme_" + theme);
    });
  }
}
