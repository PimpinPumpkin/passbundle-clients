import { ComponentFixture, TestBed } from "@angular/core/testing";
import { of } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { BrowserApi } from "../../platform/browser/browser-api";

import { KeykeeperTwoStepNudgeComponent } from "./two-step-nudge.component";

describe("the popup's nudge about two-step login", () => {
  let fixture: ComponentFixture<KeykeeperTwoStepNudgeComponent>;
  let send: jest.Mock;

  const el = () => fixture.nativeElement as HTMLElement;
  const callout = () => el().querySelector('[data-testid="two-step-nudge"]');
  const button = (name: string) =>
    Array.from(callout()?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === name,
    );

  /** The popup's vault, with the server answering `GET /keykeeper/two-step-nudge` with `answer`. */
  async function show(answer: unknown) {
    send = jest.fn(async (method: string) => (method === "GET" ? answer : null));
    await TestBed.configureTestingModule({
      imports: [KeykeeperTwoStepNudgeComponent],
      providers: [
        { provide: ApiService, useValue: { send } },
        {
          provide: EnvironmentService,
          useValue: {
            environment$: of({ getWebVaultUrl: () => "https://vault.example.test" }),
          },
        },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperTwoStepNudgeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => jest.restoreAllMocks());

  it("asks someone with no two-step login to add it, and Set it up opens the web vault's two-step settings", async () => {
    const opened = jest.spyOn(BrowserApi, "createNewTab").mockResolvedValue(undefined as any);
    await show({ show: true, nudge: "setUp" });
    expect(callout()?.textContent).toContain("Add two-step login");
    expect(callout()?.textContent).toContain("Your password is all that protects your account.");
    button("Set it up")!.click();
    await fixture.whenStable();
    expect(opened).toHaveBeenCalledWith(
      "https://vault.example.test/#/settings/security/two-factor",
    );
  });

  it("asks someone with email codes alone for a stronger method, and Not now hides it on the server", async () => {
    await show({ show: false, nudge: "stronger" });
    expect(callout()?.textContent).toContain("Add a stronger second step");
    expect(callout()?.textContent).toContain(
      "Codes by email are only as safe as your email account. An authenticator app or a security key is safer.",
    );
    button("Not now")!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(callout()).toBeNull();
    expect(send).toHaveBeenCalledWith(
      "POST",
      "/keykeeper/two-step-nudge/dismiss",
      null,
      true,
      true,
    );
  });

  it("shows the first nudge for an older server's show, and nothing when it says neither", async () => {
    await show({ show: true });
    expect(callout()?.textContent).toContain("Add two-step login");
    TestBed.resetTestingModule();
    await show({ show: false, nudge: null });
    expect(callout()).toBeNull();
  });
});
