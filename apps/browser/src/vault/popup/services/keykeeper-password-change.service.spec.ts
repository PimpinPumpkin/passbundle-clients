import { TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { DialogService, ToastService } from "@bitwarden/components";
import { PasswordRepromptService } from "@bitwarden/vault";

import { PASSWORD_CHANGE_START } from "../../../autofill/keykeeper/password-change/password-change-messages";
import { BrowserApi } from "../../../platform/browser/browser-api";
import BrowserPopupUtils from "../../../platform/browser/browser-popup-utils";

import { BrowserPasswordChangeService } from "./keykeeper-password-change.service";

function login(): CipherView {
  const item = new CipherView();
  item.id = "item-1";
  item.type = CipherType.Login;
  item.edit = true;
  item.viewPassword = true;
  item.login = new LoginView();
  item.login.password = "old-password-1";
  const website = new LoginUriView();
  website.uri = "https://accounts.example.test/login";
  item.login.uris = [website];
  return item;
}

describe("BrowserPasswordChangeService", () => {
  let service: BrowserPasswordChangeService;
  let dialogService: MockProxy<DialogService>;
  let reprompt: MockProxy<PasswordRepromptService>;
  let toastService: MockProxy<ToastService>;
  let send: jest.SpyInstance;

  beforeEach(() => {
    dialogService = mock<DialogService>();
    dialogService.openSimpleDialog.mockResolvedValue(true);
    reprompt = mock<PasswordRepromptService>();
    reprompt.passwordRepromptCheck.mockResolvedValue(true);
    toastService = mock<ToastService>();
    send = jest
      .spyOn(BrowserApi, "sendMessageWithResponse")
      .mockResolvedValue({ result: { started: true } });
    jest.spyOn(BrowserPopupUtils, "inPopup").mockReturnValue(false);
    TestBed.configureTestingModule({
      providers: [
        BrowserPasswordChangeService,
        { provide: DialogService, useValue: dialogService },
        { provide: PasswordRepromptService, useValue: reprompt },
        { provide: ToastService, useValue: toastService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    });
    service = TestBed.inject(BrowserPasswordChangeService);
  });

  afterEach(() => jest.restoreAllMocks());

  it("is available for a personal login the person can edit and see, not for an organization's yet", () => {
    expect(service.available(login())).toBe(true);
    const shared = login();
    shared.organizationId = "org-1";
    expect(service.available(shared)).toBe(false);
    const hidden = login();
    hidden.viewPassword = false;
    expect(service.available(hidden)).toBe(false);
  });

  it("asks for the master password, says what happens, then asks the background to start", async () => {
    expect(await service.confirmAndStart(login())).toBe(true);
    expect(reprompt.passwordRepromptCheck).toHaveBeenCalled();
    expect(dialogService.openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: {
          key: "keykeeperPasswordChangeConfirmTitle",
          placeholders: ["accounts.example.test"],
        },
        acceptButtonText: { key: "changePassword" },
      }),
    );
    expect(send).toHaveBeenCalledWith(PASSWORD_CHANGE_START, {
      cipherId: "item-1",
      repromptPassed: true,
    });
  });

  it("starts nothing when the master password prompt or the dialog is cancelled", async () => {
    reprompt.passwordRepromptCheck.mockResolvedValueOnce(false);
    expect(await service.confirmAndStart(login())).toBe(false);
    dialogService.openSimpleDialog.mockResolvedValueOnce(false);
    expect(await service.confirmAndStart(login())).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("says why it didn't start", async () => {
    send.mockResolvedValue({ result: { started: false, reason: "running" } });
    expect(await service.confirmAndStart(login())).toBe(false);
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "keykeeperPasswordChangeNotStartedRunning",
      }),
    );
  });

  it("starts nothing for an item it isn't available for", async () => {
    const readOnly = login();
    readOnly.edit = false;
    expect(await service.confirmAndStart(readOnly)).toBe(false);
    expect(dialogService.openSimpleDialog).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
