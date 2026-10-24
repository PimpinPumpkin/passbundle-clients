import { BehaviorSubject } from "rxjs";

import { Theme, ThemeTypes } from "@bitwarden/common/platform/enums";
import { ThemeStateService } from "@bitwarden/common/platform/theming/theme-state.service";

import { KeykeeperPopupThemingService } from "./popup-theming.service";

describe("KeykeeperPopupThemingService", () => {
  afterEach(() => {
    document.documentElement.className = "";
  });

  it("follows the device for System and the choice for Light and Dark, and never turns Glass on", () => {
    const selected = new BehaviorSubject<Theme>(ThemeTypes.System);
    const system = new BehaviorSubject<Theme>(ThemeTypes.Dark);
    const service = new KeykeeperPopupThemingService(
      { selectedTheme$: selected } as unknown as ThemeStateService,
      system,
    );
    document.documentElement.classList.add("pb-popup", "pb-glass");
    const classes = () => [...document.documentElement.classList].sort();

    const subscription = service.applyThemeChangesTo(document);
    expect(classes()).toEqual(["pb-popup", "theme_dark"]);

    system.next(ThemeTypes.Light);
    expect(classes()).toEqual(["pb-popup", "theme_light"]);

    selected.next(ThemeTypes.Dark);
    expect(classes()).toEqual(["pb-popup", "theme_dark"]);

    selected.next(ThemeTypes.System);
    expect(classes()).toEqual(["pb-popup", "theme_light"]);

    subscription.unsubscribe();
  });
});
