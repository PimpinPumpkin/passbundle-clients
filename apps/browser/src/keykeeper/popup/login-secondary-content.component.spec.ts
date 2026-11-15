import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { of, ReplaySubject } from "rxjs";

import {
  EnvironmentService,
  Region,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DefaultServerSettingsService } from "@bitwarden/common/platform/services/default-server-settings.service";

import { KeykeeperLoginSecondaryContentComponent } from "./login-secondary-content.component";

describe("KeykeeperLoginSecondaryContentComponent", () => {
  let fixture: ComponentFixture<KeykeeperLoginSecondaryContentComponent>;
  let registrationDisabled$: ReplaySubject<boolean>;

  const el = () => fixture.nativeElement as HTMLElement;
  const createAccount = () => el().querySelector('[data-testid="login-create-account-link"]');
  const closed = () => el().querySelector('[data-testid="keykeeper-new-accounts-closed"]');

  beforeEach(async () => {
    registrationDisabled$ = new ReplaySubject<boolean>(1);
    await TestBed.configureTestingModule({
      imports: [KeykeeperLoginSecondaryContentComponent],
      providers: [
        provideRouter([]),
        {
          provide: DefaultServerSettingsService,
          useValue: { isUserRegistrationDisabled$: registrationDisabled$ },
        },
        {
          provide: EnvironmentService,
          useValue: { globalEnvironment$: of({ getRegion: () => Region.SelfHosted }) },
        },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperLoginSecondaryContentComponent);
    fixture.detectChanges();
  });

  it("shows nothing until the server's settings are in", () => {
    expect(el().textContent?.trim()).toBe("");
    expect(createAccount()).toBeNull();
  });

  it("offers Create account on a server that takes new accounts", () => {
    registrationDisabled$.next(false);
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="keykeeper-new-here"]')?.textContent).toContain(
      "keykeeperNewHere",
    );
    expect(createAccount()?.getAttribute("href")).toBe("/signup");
    expect(closed()).toBeNull();
  });

  it("says the server isn't taking new accounts, with no Create account link, on one that doesn't", () => {
    registrationDisabled$.next(true);
    fixture.detectChanges();

    expect(createAccount()).toBeNull();
    expect(closed()?.textContent).toContain("keykeeperNewAccountsOwnServer");
  });

  it("follows the server when it changes", () => {
    registrationDisabled$.next(true);
    fixture.detectChanges();
    registrationDisabled$.next(false);
    fixture.detectChanges();

    expect(closed()).toBeNull();
    expect(createAccount()).not.toBeNull();
  });
});
