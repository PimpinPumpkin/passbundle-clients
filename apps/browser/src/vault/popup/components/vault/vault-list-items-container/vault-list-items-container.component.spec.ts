import { CUSTOM_ELEMENTS_SCHEMA } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { Router } from "@angular/router";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CompactModeService, DialogService } from "@bitwarden/components";
import { KeykeeperOpenAndFillService, PasswordRepromptService } from "@bitwarden/vault";

import { BrowserApi } from "../../../../../platform/browser/browser-api";
import { BrowserOpenAndFillService } from "../../../services/keykeeper-open-and-fill.service";
import { VaultPopupAutofillService } from "../../../services/vault-popup-autofill.service";
import { VaultPopupSectionService } from "../../../services/vault-popup-section.service";
import { PopupCipherViewLike } from "../../../views/popup-cipher.view";

import { VaultListItemsContainerComponent } from "./vault-list-items-container.component";

describe("VaultListItemsContainerComponent", () => {
  let fixture: ComponentFixture<VaultListItemsContainerComponent>;
  let component: VaultListItemsContainerComponent;

  const currentTabIsOnBlocklist$ = new BehaviorSubject<boolean>(false);

  const mockCipher = {
    id: "cipher-1",
    name: "Test Login",
    type: CipherType.Login,
    login: {
      username: "user@example.com",
      uris: [{ uri: "https://example.com", match: null }],
    },
    favorite: false,
    reprompt: 0,
    organizationId: null,
    collectionIds: [],
    edit: true,
    viewPassword: true,
  } as any;

  const vaultPopupAutofillService = {
    currentTabIsOnBlocklist$: currentTabIsOnBlocklist$.asObservable(),
    doAutofill: jest.fn(),
  };

  const compactModeService = {
    enabled$: of(false),
  };

  const openAndFill = { open: jest.fn().mockResolvedValue(true) };

  const vaultPopupSectionService = {
    getOpenDisplayStateForSection: jest.fn().mockReturnValue(() => true),
    updateSectionOpenStoredState: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    currentTabIsOnBlocklist$.next(false);

    await TestBed.configureTestingModule({
      imports: [VaultListItemsContainerComponent, NoopAnimationsModule],
      providers: [
        { provide: VaultPopupAutofillService, useValue: vaultPopupAutofillService },
        { provide: CompactModeService, useValue: compactModeService },
        { provide: VaultPopupSectionService, useValue: vaultPopupSectionService },
        { provide: I18nService, useValue: { t: (k: string) => k } },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "UserId" }) } },
        { provide: CipherService, useValue: mock<CipherService>() },
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: PasswordRepromptService, useValue: mock<PasswordRepromptService>() },
        {
          provide: KeykeeperOpenAndFillService,
          useValue: Object.assign(new BrowserOpenAndFillService(), openAndFill),
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideProvider(DialogService, { useValue: mock<DialogService>() })
      .compileComponents();

    fixture = TestBed.createComponent(VaultListItemsContainerComponent);
    component = fixture.componentInstance;
  });

  describe("item actions", () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it("should show fill text on hover for autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", true);
      fixture.detectChanges();

      expect(component.showFillTextOnHover()).toBe(true);
    });

    it("should not show fill text on hover for non-autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", false);
      fixture.detectChanges();

      expect(component.showFillTextOnHover()).toBe(false);
    });

    it("should hide launch button for autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", true);
      fixture.detectChanges();

      expect(component.showLaunchButton()).toBe(false);
    });

    it("should show launch button for non-autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", false);
      fixture.detectChanges();

      expect(component.showLaunchButton()).toBe(true);
    });

    it("should show autofill in menu for non-autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", false);
      fixture.detectChanges();

      expect(component.showAutofillInMenu()).toBe(true);
    });

    it("should hide autofill in menu for autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", true);
      fixture.detectChanges();

      expect(component.showAutofillInMenu()).toBe(false);
    });

    it("should show view in menu for autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", true);
      fixture.detectChanges();

      expect(component.showViewInMenu()).toBe(true);
    });

    it("should hide view in menu for non-autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", false);
      fixture.detectChanges();

      expect(component.showViewInMenu()).toBe(false);
    });

    it("should autofill on select for autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", true);
      fixture.detectChanges();

      expect(component.canAutofill()).toBe(true);
    });

    it("should not autofill on select for non-autofill list items", () => {
      fixture.componentRef.setInput("isAutofillList", false);
      fixture.detectChanges();

      expect(component.canAutofill()).toBe(false);
    });

    describe("when current URI is blocked", () => {
      beforeEach(() => {
        currentTabIsOnBlocklist$.next(true);
        fixture.detectChanges();
      });

      it("should not autofill on select even when isAutofillList is true", () => {
        fixture.componentRef.setInput("isAutofillList", true);
        fixture.detectChanges();

        expect(component.canAutofill()).toBe(false);
      });
    });
  });

  describe("Keykeeper: Open and fill", () => {
    let reprompt: jest.Mocked<PasswordRepromptService>;
    let createNewTab: jest.SpyInstance;
    let closePopup: jest.SpyInstance;

    const login = (uris: { uri: string }[], repromptType = 0) =>
      ({ ...mockCipher, reprompt: repromptType, login: { ...mockCipher.login, uris } }) as any;

    beforeEach(() => {
      reprompt = TestBed.inject(PasswordRepromptService) as jest.Mocked<PasswordRepromptService>;
      createNewTab = jest
        .spyOn(BrowserApi, "createNewTab")
        .mockResolvedValue({} as chrome.tabs.Tab);
      // Opening a tab closes the popup, which here is the test's own window.
      closePopup = jest.spyOn(BrowserApi, "closePopup").mockImplementation(() => {});
      fixture.detectChanges();
    });

    afterEach(() => {
      createNewTab.mockRestore();
      closePopup.mockRestore();
    });

    it("opens a login's website to fill it, asking for the master password before the tab opens", async () => {
      reprompt.passwordRepromptCheck.mockResolvedValue(true);

      await component.launchCipher(login([{ uri: "https://example.com" }], 1));

      expect(reprompt.passwordRepromptCheck).toHaveBeenCalled();
      expect(openAndFill.open).toHaveBeenCalledWith("cipher-1", "https://example.com/");
      expect(reprompt.passwordRepromptCheck.mock.invocationCallOrder[0]).toBeLessThan(
        openAndFill.open.mock.invocationCallOrder[0],
      );
      expect(createNewTab).not.toHaveBeenCalled();
    });

    it("opens nothing when the master password prompt is cancelled", async () => {
      reprompt.passwordRepromptCheck.mockResolvedValue(false);

      await component.launchCipher(login([{ uri: "https://example.com" }], 1));

      expect(openAndFill.open).not.toHaveBeenCalled();
      expect(createNewTab).not.toHaveBeenCalled();
    });

    it("only opens a login whose websites can't fill", async () => {
      await component.launchCipher(login([{ uri: "ssh://server.example.com" }]));

      expect(openAndFill.open).not.toHaveBeenCalled();
      expect(createNewTab).toHaveBeenCalledWith("ssh://server.example.com");
    });

    it("is for logins with a website that can fill", () => {
      expect(component["openAndFillUrl"](login([{ uri: "https://example.com" }]))).toBe(
        "https://example.com/",
      );
      expect(component["openAndFillUrl"](login([{ uri: "ssh://server.example.com" }]))).toBeNull();
      expect(component["openAndFillUrl"]({ ...mockCipher, type: CipherType.Card })).toBeNull();
    });
  });

  describe("cipherItemTitleKey", () => {
    it("should return autofillTitle when canAutofill is true", () => {
      fixture.componentRef.setInput("isAutofillList", true);
      fixture.detectChanges();

      const titleKeyFn = component.cipherItemTitleKey();
      const result = titleKeyFn(mockCipher);

      expect(result).toBe("autofillTitleWithField");
    });

    it("should return viewItemTitle when canAutofill is false", () => {
      fixture.componentRef.setInput("isAutofillList", false);
      fixture.detectChanges();

      const titleKeyFn = component.cipherItemTitleKey();
      const result = titleKeyFn(mockCipher);

      expect(result).toBe("viewItemTitleWithField");
    });

    it("should return title without WithField when cipher has no username", () => {
      fixture.componentRef.setInput("isAutofillList", false);
      fixture.detectChanges();

      const cipherWithoutUsername = {
        ...mockCipher,
        login: { ...mockCipher.login, username: null },
      } as PopupCipherViewLike;

      const titleKeyFn = component.cipherItemTitleKey();
      const result = titleKeyFn(cipherWithoutUsername);

      expect(result).toBe("viewItemTitle");
    });
  });
});
