import { ComponentFixture, TestBed } from "@angular/core/testing";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import {
  KeykeeperPasswordHealthLineComponent,
  keykeeperTimeAgo,
} from "./password-health-line.component";

describe("keykeeperTimeAgo", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const ago = (seconds: number) =>
    keykeeperTimeAgo(new Date(now.getTime() - seconds * 1000), now, "en", "just now");

  it("says how long ago, in the largest whole unit", () => {
    expect(ago(21 * 24 * 3600)).toBe("3 weeks ago");
    expect(ago(24 * 3600)).toBe("yesterday");
    expect(ago(2 * 3600)).toBe("2 hours ago");
    expect(ago(400 * 24 * 3600)).toBe("last year");
  });

  it("says just now for less than a minute", () => {
    expect(ago(20)).toBe("just now");
  });
});

describe("KeykeeperPasswordHealthLineComponent", () => {
  let fixture: ComponentFixture<KeykeeperPasswordHealthLineComponent>;
  let score: number;

  const login = (password: string | null, changed?: Date) => {
    const cipher = new CipherView();
    cipher.type = CipherType.Login;
    cipher.name = "Contoso Mail";
    cipher.viewPassword = true;
    cipher.creationDate = new Date("2026-09-01T12:00:00Z");
    cipher.login = new LoginView();
    cipher.login.username = "alex@contoso.example";
    cipher.login.password = password ?? undefined;
    cipher.login.passwordRevisionDate = changed;
    return cipher;
  };

  const line = () =>
    (fixture.nativeElement as HTMLElement)
      .querySelector('[data-testid="keykeeper-password-health"]')
      ?.textContent?.trim();

  beforeEach(async () => {
    jest.useFakeTimers({ now: new Date("2026-10-23T12:00:00Z") });
    score = 4;
    await TestBed.configureTestingModule({
      imports: [KeykeeperPasswordHealthLineComponent],
      providers: [
        {
          provide: I18nService,
          useValue: {
            translationLocale: "en",
            t: (key: string, when?: string) =>
              ({
                keykeeperPasswordStrong: "Password strong",
                keykeeperPasswordGood: "Password good",
                keykeeperPasswordWeak: "Password weak",
                keykeeperPasswordChanged: `changed ${when}`,
                keykeeperPasswordAdded: `added ${when}`,
                keykeeperJustNow: "just now",
              })[key] ?? key,
          },
        },
        {
          provide: PasswordStrengthServiceAbstraction,
          useValue: { getPasswordStrength: () => ({ score }) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperPasswordHealthLineComponent);
  });

  afterEach(() => jest.useRealTimers());

  it("says how strong the password is and when it changed", () => {
    fixture.componentRef.setInput("cipher", login("x", new Date("2026-10-02T12:00:00Z")));
    fixture.detectChanges();

    expect(line()).toBe("Password strong · changed 3 weeks ago");
  });

  it("says when the item was added when its password never changed", () => {
    score = 3;
    fixture.componentRef.setInput("cipher", login("x"));
    fixture.detectChanges();

    expect(line()).toBe("Password good · added last month");
  });

  it("marks a weak password", () => {
    score = 1;
    fixture.componentRef.setInput("cipher", login("x"));
    fixture.detectChanges();

    expect(line()).toContain("Password weak");
    expect((fixture.nativeElement as HTMLElement).querySelector("[data-weak]")).not.toBeNull();
  });

  it("says nothing for a login without a password, or one its owner can't see", () => {
    fixture.componentRef.setInput("cipher", login(null));
    fixture.detectChanges();
    expect(line()).toBeUndefined();

    const hidden = login("x");
    hidden.viewPassword = false;
    fixture.componentRef.setInput("cipher", hidden);
    fixture.detectChanges();
    expect(line()).toBeUndefined();
  });
});
