import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { awaitAsync, FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";

import { USE_SITE_FIXES } from "../site-fixes";
import { KeykeeperSiteRules, USE_PASSBUNDLE_SITE_RULES } from "../site-rules";
import type { SiteRules } from "../site-rules-feed";

import { KeykeeperSiteFixesSettingsComponent } from "./site-fixes-settings.component";

const userId = "user" as UserId;
const rules: SiteRules = {
  sequence: 1,
  issued: "2026-11-18T00:00:00Z",
  expires: "2026-12-02T00:00:00Z",
  sha256: "0".repeat(64),
  hosts: {},
};

describe("KeykeeperSiteFixesSettingsComponent", () => {
  let fixture: ComponentFixture<KeykeeperSiteFixesSettingsComponent>;
  let state: FakeStateProvider;
  const accountService = mockAccountServiceWith(userId);

  async function render(t: (key: string, ...values: string[]) => string = () => "") {
    await TestBed.configureTestingModule({
      imports: [KeykeeperSiteFixesSettingsComponent],
      providers: [
        provideRouter([]),
        { provide: AccountService, useValue: accountService },
        { provide: StateProvider, useValue: state },
        { provide: I18nService, useValue: { t } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperSiteFixesSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await awaitAsync(10);
    fixture.detectChanges();
  }

  const box = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`#${id}`) as HTMLInputElement;
  const label = (id: string) =>
    (fixture.nativeElement as HTMLElement)
      .querySelector(`label[for=${id}], bit-label[for=${id}]`)
      ?.textContent?.trim();
  const click = async (id: string) => {
    box(id).click();
    await fixture.whenStable();
    await awaitAsync(10);
    fixture.detectChanges();
  };
  const kept = () => firstValueFrom(state.getUser(userId, KeykeeperSiteRules.KEPT).state$);

  beforeEach(() => {
    state = new FakeStateProvider(accountService);
  });

  it("uses PassBundle's site rules until the person turns it off, in the product's name", async () => {
    const words: Record<string, string> = {
      keykeeperProductName: "PassBundle",
      keykeeperUseSiteRules: "Use $1's site rules",
    };
    await render((key, ...values) => (words[key] ?? "").replace("$1", values[0] ?? ""));

    expect(box("use-site-rules").checked).toBe(true);
    expect(label("use-site-rules")).toBe("Use PassBundle's site rules");
  });

  it("turned off, drops PassBundle's rules kept on the device, and only those", async () => {
    await state.getUser(userId, KeykeeperSiteRules.KEPT).update(() => ({
      source: "passbundle" as const,
      key: null,
      rules,
    }));
    await render();

    await click("use-site-rules");
    expect(await firstValueFrom(state.getUser(userId, USE_PASSBUNDLE_SITE_RULES).state$)).toBe(
      false,
    );
    expect(await kept()).toBeNull();
    expect(box("use-site-rules").checked).toBe(false);
  });

  it("an operator's rules go with “Use fixes other people share”, not with PassBundle's", async () => {
    const operator = { source: "operator" as const, key: "a".repeat(64), rules };
    await state.getUser(userId, KeykeeperSiteRules.KEPT).update(() => operator);
    await render();

    await click("use-site-rules");
    expect(await kept()).toEqual(operator);

    await click("use-site-fixes");
    expect(await firstValueFrom(state.getUser(userId, USE_SITE_FIXES).state$)).toBe(false);
    expect(await kept()).toBeNull();
  });

  it("says what the rules are in English without our strings, with the app's name", async () => {
    await render((key) => (key === "appName" ? "PassBundle" : ""));
    expect(label("use-site-rules")).toBe("Use PassBundle's site rules");
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Rules PassBundle checked for sites that don't fill right, from your server.",
    );
  });
});
