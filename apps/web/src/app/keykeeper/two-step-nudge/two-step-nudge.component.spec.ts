import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";

import { TwoStepNudgeKind } from "@bitwarden/admin-console/common";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { I18nMockService } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperTwoStepNudgeComponent } from "./two-step-nudge.component";

describe("the vault page's nudge about two-step login", () => {
  let fixture: ComponentFixture<KeykeeperTwoStepNudgeComponent>;
  let dismissed: jest.Mock;

  const el = () => fixture.nativeElement as HTMLElement;
  const banner = () => el().querySelector('[data-testid="two-step-nudge"]');

  async function show(nudge: TwoStepNudgeKind | null) {
    dismissed = jest.fn(async () => {});
    await TestBed.configureTestingModule({
      imports: [KeykeeperTwoStepNudgeComponent],
      providers: [
        provideRouter([]),
        {
          provide: KeykeeperMspApiService,
          useValue: { twoStepNudge: async () => nudge, dismissTwoStepNudge: dismissed },
        },
        { provide: I18nService, useFactory: () => new I18nMockService({ close: "Close" }) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperTwoStepNudgeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it("asks someone with no two-step login to set it up, and Not now hides it", async () => {
    await show("setUp");
    expect(banner()?.textContent).toContain(
      "Your password is all that protects your account. Add a second step, such as an authenticator app, so a stolen password isn't enough.",
    );
    expect(banner()?.getAttribute("data-nudge")).toBe("setUp");
    const setUp = banner()?.querySelector("a");
    expect(setUp?.textContent?.trim()).toBe("Set it up");
    expect(setUp?.getAttribute("href")).toBe("/settings/security/two-factor");

    const notNow = Array.from(banner()!.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Not now",
    );
    notNow!.click();
    fixture.detectChanges();
    expect(banner()).toBeNull();
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it("asks someone with email codes alone for a stronger method, with the same Set it up", async () => {
    await show("stronger");
    expect(banner()?.textContent).toContain(
      "Codes by email are only as safe as your email account. An authenticator app or a security key is safer.",
    );
    expect(banner()?.textContent).not.toContain("Your password is all that protects your account");
    expect(banner()?.querySelector("a")?.getAttribute("href")).toBe(
      "/settings/security/two-factor",
    );
  });

  it("shows nothing when the server says no", async () => {
    await show(null);
    expect(banner()).toBeNull();
  });
});
