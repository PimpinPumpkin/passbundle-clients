// Keykeeper: the System setting is PassBundle's "Glass" look; Light and Dark
// are solid. See brand/look.css.
import { BehaviorSubject } from "rxjs";

import { Theme, ThemeTypes } from "@bitwarden/common/platform/enums";
import { ThemeStateService } from "@bitwarden/common/platform/theming/theme-state.service";

import { AngularThemingService } from "./angular-theming.service";

describe("AngularThemingService", () => {
  afterEach(() => {
    document.documentElement.className = "";
  });

  it("marks the page as glass for the System setting, light or dark like the device, and solid for Light and Dark", () => {
    const selected = new BehaviorSubject<Theme>(ThemeTypes.System);
    const system = new BehaviorSubject<Theme>(ThemeTypes.Dark);
    const service = new AngularThemingService(
      { selectedTheme$: selected } as unknown as ThemeStateService,
      system,
    );
    const classes = () => [...document.documentElement.classList].sort();

    const subscription = service.applyThemeChangesTo(document);
    expect(classes()).toEqual(["pb-glass", "theme_dark"]);

    system.next(ThemeTypes.Light);
    expect(classes()).toEqual(["pb-glass", "theme_light"]);

    selected.next(ThemeTypes.Dark);
    expect(classes()).toEqual(["theme_dark"]);

    selected.next(ThemeTypes.Light);
    expect(classes()).toEqual(["theme_light"]);

    selected.next(ThemeTypes.System);
    expect(classes()).toEqual(["pb-glass", "theme_light"]);

    subscription.unsubscribe();
  });
});
