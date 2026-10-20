import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { BrowserApi } from "../../platform/browser/browser-api";
import AutofillField from "../models/autofill-field";

import {
  addCipherToFillFieldMenu,
  choicesFor,
  createdFillFieldMenuIds,
  FILL_FIELD_ID,
  handleFillFieldMenuClick,
  initFillFieldMenu,
  parseFillFieldMenuId,
} from "./fill-field-menu";
import { readFillRules } from "./fill-rules";

const cipherId = "1b9b2c1e-0000-4000-8000-000000000001";

function bankItem(): CipherView {
  const cipher = new CipherView();
  cipher.id = cipherId;
  cipher.name = "Example Bank";
  cipher.type = CipherType.Login;
  cipher.login = new LoginView();
  cipher.login.username = "alice";
  cipher.login.password = "correct-password";
  const customerId = new FieldView();
  customerId.name = "Customer ID";
  customerId.value = "C-12345";
  customerId.type = FieldType.Text;
  const remember = new FieldView();
  remember.name = "Remember me";
  remember.value = "true";
  remember.type = FieldType.Boolean;
  cipher.fields = [customerId, remember];
  return cipher;
}

describe("Keykeeper fill picker menu", () => {
  describe("choicesFor", () => {
    it("offers the login values, text custom fields, and never-fill", () => {
      expect(choicesFor(bankItem()).map((c) => [c.key, c.title])).toEqual([
        ["u", "Username"],
        ["p", "Password"],
        ["f0", "Customer ID"],
        ["n", "Never fill this field"],
      ]);
    });

    it("hides the password and hidden fields when the item doesn't allow viewing them", () => {
      const cipher = bankItem();
      const pin = new FieldView();
      pin.name = "PIN";
      pin.value = "4321";
      pin.type = FieldType.Hidden;
      cipher.fields = [...cipher.fields, pin];
      expect(choicesFor(cipher).map((c) => c.title)).toContain("PIN");

      cipher.viewPassword = false;

      expect(choicesFor(cipher).map((c) => c.key)).toEqual(["u", "f0", "n"]);
    });
  });

  describe("parseFillFieldMenuId", () => {
    it("reads item and choice from our ids only", () => {
      expect(parseFillFieldMenuId(`${FILL_FIELD_ID}_${cipherId}_f0`)).toEqual({
        cipherId,
        key: "f0",
      });
      expect(parseFillFieldMenuId(`${FILL_FIELD_ID}_${cipherId}`)).toBeNull();
      expect(parseFillFieldMenuId(`autofill_${cipherId}`)).toBeNull();
    });
  });

  describe("building the menu", () => {
    let createSpy: jest.SpyInstance;

    beforeEach(() => {
      createSpy = jest
        .spyOn(chrome.contextMenus, "create")
        .mockImplementation((_props, callback) => {
          callback?.();
          return "";
        });
      createSpy.mockClear();
    });

    afterEach(() => jest.restoreAllMocks());

    it("adds the root, then one submenu per login with its values, for editable fields only", async () => {
      await initFillFieldMenu();
      await addCipherToFillFieldMenu(bankItem());
      await addCipherToFillFieldMenu(bankItem()); // a second update doesn't duplicate

      const created = createSpy.mock.calls.map(([props]) => props);
      expect(created.map((p) => p.id)).toEqual([
        FILL_FIELD_ID,
        `${FILL_FIELD_ID}_${cipherId}`,
        `${FILL_FIELD_ID}_${cipherId}_u`,
        `${FILL_FIELD_ID}_${cipherId}_p`,
        `${FILL_FIELD_ID}_${cipherId}_f0`,
        `${FILL_FIELD_ID}_${cipherId}_separator`,
        `${FILL_FIELD_ID}_${cipherId}_n`,
      ]);
      expect(created.every((p) => p.contexts?.length === 1 && p.contexts[0] === "editable")).toBe(
        true,
      );
      expect(createdFillFieldMenuIds.has(`${FILL_FIELD_ID}_${cipherId}_f0`)).toBe(true);
    });

    it("ignores items that aren't logins", async () => {
      const note = bankItem();
      note.type = CipherType.SecureNote;

      await addCipherToFillFieldMenu(note);

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe("handleFillFieldMenuClick", () => {
    const tab = { id: 7, url: "https://bank.example.test/login" } as chrome.tabs.Tab;
    const customerNumberField = {
      opid: "__3",
      htmlID: "custno",
      htmlName: "customer_number",
      "label-tag": "Customer number",
    } as AutofillField;
    let cipher: CipherView;
    let deps: {
      authService: ReturnType<typeof mock<AuthService>>;
      accountService: AccountService;
      cipherService: ReturnType<typeof mock<CipherService>>;
      totpService: ReturnType<typeof mock<TotpService>>;
      passwordRepromptRequired: jest.Mock<Promise<boolean>, [CipherView]>;
      fillAfterReprompt: jest.Mock<Promise<void>, [chrome.tabs.Tab, CipherView]>;
    };
    let tabSendMessage: jest.SpyInstance;
    /** The page or frame the right-clicked field is in. */
    let frameUrl: string;

    beforeEach(() => {
      cipher = bankItem();
      frameUrl = tab.url!;
      deps = {
        authService: mock<AuthService>(),
        accountService: {
          activeAccount$: new BehaviorSubject({ id: "user-1" }),
        } as unknown as AccountService,
        cipherService: mock<CipherService>(),
        totpService: mock<TotpService>(),
        passwordRepromptRequired: jest.fn<Promise<boolean>, [CipherView]>(async () => false),
        fillAfterReprompt: jest.fn<Promise<void>, [chrome.tabs.Tab, CipherView]>(async () => {}),
      };
      deps.authService.getAuthStatus.mockResolvedValue(AuthenticationStatus.Unlocked);
      deps.cipherService.getAllDecrypted.mockResolvedValue([cipher]);
      deps.cipherService.updateWithServer.mockImplementation(async (c) => c);
      deps.totpService.getCode$.mockReturnValue(of({ code: "123456", period: 30 }));
      tabSendMessage = jest
        .spyOn(BrowserApi, "tabSendMessage")
        .mockImplementation(async (_tab, message) => {
          if ((message as { command: string }).command === "collectAutofillTriage") {
            return {
              pageDetails: { url: frameUrl, fields: [customerNumberField] },
              targetOpid: "__3",
            };
          }
          return undefined;
        });
    });

    afterEach(() => jest.restoreAllMocks());

    const click = (key: string) =>
      handleFillFieldMenuClick(
        {
          menuItemId: `${FILL_FIELD_ID}_${cipherId}_${key}`,
          frameId: 0,
        } as chrome.contextMenus.OnClickData,
        tab,
        deps,
      );

    it("fills the right-clicked field now and saves the choice on the item", async () => {
      expect(await click("f0")).toBe(true);

      expect(tabSendMessage).toHaveBeenCalledWith(
        tab,
        expect.objectContaining({
          command: "fillForm",
          fillScript: expect.objectContaining({
            script: [
              ["click_on_opid", "__3"],
              ["focus_by_opid", "__3"],
              ["fill_by_opid", "__3", "C-12345"],
            ],
          }),
        }),
        { frameId: 0 },
      );
      expect(deps.cipherService.updateWithServer).toHaveBeenCalledWith(cipher, "user-1");
      expect(readFillRules(cipher)).toEqual([
        {
          v: 1,
          host: "bank.example.test",
          field: { id: "custno", name: "customer_number", label: "customer number" },
          fill: { from: "field", name: "Customer ID" },
        },
      ]);
    });

    const filled = () =>
      tabSendMessage.mock.calls.some(([, message]) => message.command === "fillForm");

    it("asks for the master password before filling a secret of an item that wants it", async () => {
      deps.passwordRepromptRequired.mockResolvedValue(true);

      await click("p");

      expect(filled()).toBe(false);
      expect(readFillRules(cipher)[0].fill).toEqual({ from: "password" });
      expect(deps.fillAfterReprompt).toHaveBeenCalledWith(tab, cipher);
    });

    it("fills the username of such an item at once, as upstream copies it", async () => {
      deps.passwordRepromptRequired.mockResolvedValue(true);

      await click("u");

      expect(filled()).toBe(true);
      expect(deps.fillAfterReprompt).not.toHaveBeenCalled();
    });

    it("never puts a secret into a frame from another site, and remembers nothing", async () => {
      frameUrl = "https://ads.example.net/frame";

      await click("p");

      expect(filled()).toBe(false);
      expect(readFillRules(cipher)).toEqual([]);
      expect(deps.cipherService.updateWithServer).not.toHaveBeenCalled();
    });

    it("fills a frame on another part of the same site", async () => {
      frameUrl = "https://login.example.test/frame";

      await click("p");

      expect(filled()).toBe(true);
      expect(readFillRules(cipher)[0].host).toBe("login.example.test");
    });

    it("saves never-fill without filling anything", async () => {
      await click("n");

      expect(tabSendMessage).not.toHaveBeenCalledWith(
        tab,
        expect.objectContaining({ command: "fillForm" }),
        expect.anything(),
      );
      expect(readFillRules(cipher)[0].fill).toEqual({ from: "never" });
    });

    it("does nothing while the vault is locked", async () => {
      deps.authService.getAuthStatus.mockResolvedValue(AuthenticationStatus.Locked);

      expect(await click("f0")).toBe(true);

      expect(tabSendMessage).not.toHaveBeenCalled();
      expect(deps.cipherService.updateWithServer).not.toHaveBeenCalled();
    });

    it("leaves other menu items to upstream", async () => {
      const handled = await handleFillFieldMenuClick(
        { menuItemId: `autofill_${cipherId}` } as chrome.contextMenus.OnClickData,
        tab,
        deps,
      );

      expect(handled).toBe(false);
      expect(deps.authService.getAuthStatus).not.toHaveBeenCalled();
    });
  });
});
