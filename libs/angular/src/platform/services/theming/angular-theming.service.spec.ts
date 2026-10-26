// Keykeeper: PassBundle has no Glass theme anymore. The web vault and the
// extension's popup have the same design language in every theme, so System
// is light or dark like the device and nothing else changes on the page
// (DESIGN.md, "The look", in the keykeeper repo).
import { BehaviorSubject } from "rxjs";

import { Theme, ThemeTypes } from "@bitwarden/common/platform/enums";
import { ThemeStateService } from "@bitwarden/common/platform/theming/theme-state.service";

import { AngularThemingService } from "./angular-theming.service";

describe("AngularThemingService", () => {
  afterEach(() => {
    document.documentElement.className = "";
  });

  it("follows the device for System and the choice for Light and Dark, and leaves the page's own classes alone", () => {
    const selected = new BehaviorSubject<Theme>(ThemeTypes.System);
    const system = new BehaviorSubject<Theme>(ThemeTypes.Dark);
    const service = new AngularThemingService(
      { selectedTheme$: selected } as unknown as ThemeStateService,
      system,
    );
    document.documentElement.classList.add("pb-web");
    const classes = () => [...document.documentElement.classList].sort();

    const subscription = service.applyThemeChangesTo(document);
    expect(classes()).toEqual(["pb-web", "theme_dark"]);

    system.next(ThemeTypes.Light);
    expect(classes()).toEqual(["pb-web", "theme_light"]);

    selected.next(ThemeTypes.Dark);
    expect(classes()).toEqual(["pb-web", "theme_dark"]);

    selected.next(ThemeTypes.Light);
    expect(classes()).toEqual(["pb-web", "theme_light"]);

    selected.next(ThemeTypes.System);
    expect(classes()).toEqual(["pb-web", "theme_light"]);

    subscription.unsubscribe();
  });
});
