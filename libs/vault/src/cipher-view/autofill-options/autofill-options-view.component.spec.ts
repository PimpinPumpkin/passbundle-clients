import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { openAndFillUrl } from "@bitwarden/common/vault/keykeeper/open-and-fill";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { ToastService } from "@bitwarden/components";

import { KeykeeperOpenAndFillService } from "../../keykeeper/open-and-fill.service";

import { AutofillOptionsViewComponent } from "./autofill-options-view.component";

// Keykeeper: "Open and fill" beside each website's plain open, where the app
// has it (DESIGN.md, "Open and fill").
describe("AutofillOptionsViewComponent", () => {
  let fixture: ComponentFixture<AutofillOptionsViewComponent>;
  const launchUri = jest.fn();
  const open = jest.fn().mockResolvedValue(true);
  const updateLastLaunchedDate = jest.fn();

  const website = (uri: string, match?: number) => {
    const view = new LoginUriView();
    view.uri = uri;
    view.match = match as LoginUriView["match"];
    return view;
  };

  async function render(openAndFill: boolean) {
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      providers: [
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>({ launchUri }) },
        { provide: CipherService, useValue: mock<CipherService>({ updateLastLaunchedDate }) },
        {
          provide: AccountService,
          useValue: { activeAccount$: new BehaviorSubject({ id: "user-1" as UserId }) },
        },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: ToastService, useValue: mock<ToastService>() },
        ...(openAndFill
          ? [
              {
                provide: KeykeeperOpenAndFillService,
                useValue: { urlFor: openAndFillUrl, open },
              },
            ]
          : []),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AutofillOptionsViewComponent);
    fixture.componentInstance.cipherId = "cipher-1";
    fixture.componentInstance.loginUris = [
      website("https://bank.example.test/login"),
      website("ssh://server.example.test"),
      website("https://www.bank.example.test", UriMatchStrategy.Never),
    ];
    fixture.detectChanges();
  }

  const buttons = (testId: string) =>
    fixture.debugElement.queryAll(By.css(`[data-testid="${testId}"]`));

  it("offers Open and fill for each website that can fill, beside the plain open", async () => {
    await render(true);

    expect(buttons("launch-website")).toHaveLength(3);
    expect(buttons("open-and-fill-website")).toHaveLength(1);

    buttons("open-and-fill-website")[0].nativeElement.click();
    await fixture.whenStable();

    expect(open).toHaveBeenCalledWith("cipher-1", "https://bank.example.test/login");
    expect(launchUri).not.toHaveBeenCalled();
  });

  it("only opens, where the app doesn't have it (the web vault)", async () => {
    await render(false);

    expect(buttons("launch-website")).toHaveLength(3);
    expect(buttons("open-and-fill-website")).toHaveLength(0);
  });
});
