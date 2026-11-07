// Keykeeper: "Send email" on the verify email banner, when the address turns
// out to be verified already (from the link, maybe on another device).
import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { TokenService } from "@bitwarden/common/auth/abstractions/token.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { FakeAccountService, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { ToastService } from "@bitwarden/components";

import { VerifyEmailComponent } from "./verify-email.component";

describe("VerifyEmailComponent", () => {
  const userId = Utils.newGuid() as UserId;
  let accountService: FakeAccountService;
  const apiService = mock<ApiService>();
  const tokenService = mock<TokenService>();
  let component: VerifyEmailComponent;

  beforeEach(async () => {
    accountService = mockAccountServiceWith(userId, { emailVerified: false });
    apiService.refreshIdentityToken.mockReset().mockResolvedValue(undefined);
    apiService.postAccountVerifyEmail.mockReset().mockResolvedValue(undefined);
    tokenService.getEmailVerified.mockReset();

    await TestBed.configureTestingModule({
      imports: [VerifyEmailComponent],
      providers: [
        { provide: AccountService, useValue: accountService },
        { provide: ApiService, useValue: apiService },
        { provide: I18nService, useValue: mock<I18nService>({ t: (key) => key }) },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        { provide: TokenService, useValue: tokenService },
        { provide: ToastService, useValue: mock<ToastService>() },
      ],
    }).compileComponents();

    component = TestBed.createComponent(VerifyEmailComponent).componentInstance;
  });

  it("marks the account verified when the address already is, and sends no email", async () => {
    tokenService.getEmailVerified.mockResolvedValue(true);
    const verified = jest.fn();
    component.onVerified.subscribe(verified);

    await component.send();

    expect(accountService.mock.setAccountEmailVerified).toHaveBeenCalledWith(userId, true);
    expect(verified).toHaveBeenCalledWith(true);
    expect(apiService.postAccountVerifyEmail).not.toHaveBeenCalled();
  });

  it("sends the email, and leaves the account alone, when the address isn't verified", async () => {
    tokenService.getEmailVerified.mockResolvedValue(false);

    await component.send();

    expect(apiService.postAccountVerifyEmail).toHaveBeenCalled();
    expect(accountService.mock.setAccountEmailVerified).not.toHaveBeenCalled();
  });
});
