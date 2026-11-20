import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { FillRule } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { BrowserApi } from "../../platform/browser/browser-api";
import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import AutofillService from "../services/autofill.service";

import {
  addCipherToFillFieldMenu,
  choicesFor,
  createdFillFieldMenuIds,
  FILL_FIELD_ID,
  fillPickerWords,
  finishPickAfterReprompt,
  handleFillFieldMenuClick,
  initFillFieldMenu,
  keykeeperFillPicker,
  labelSuggestion,
  parseFillFieldMenuId,
} from "./fill-field-menu";
import {
  keykeeperSiteFixes,
  keykeeperSiteNeverFill,
  readFillRules,
  upsertFillRule as upsert,
} from "./fill-rules";

const cipherId = "1b9b2c1e-0000-4000-8000-000000000001";

function bankItem(): CipherView {
  const cipher = new CipherView();
  cipher.id = cipherId;
  cipher.name = "Example Bank";
  cipher.type = CipherType.Login;
  cipher.login = new LoginView();
  cipher.login.username = "alice";
  cipher.login.password = "correct-password";
  const website = new LoginUriView();
  website.uri = "https://bank.example.test/login";
  cipher.login.uris = [website];
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

const cardId = "1b9b2c1e-0000-4000-8000-000000000002";

function cardItem(): CipherView {
  const cipher = new CipherView();
  cipher.id = cardId;
  cipher.name = "Everyday Visa";
  cipher.type = CipherType.Card;
  cipher.viewPassword = true;
  cipher.card = new CardView();
  cipher.card.cardholderName = "Alice Example";
  cipher.card.number = "4111111111111111";
  cipher.card.expMonth = "3";
  cipher.card.expYear = "2029";
  cipher.card.code = "123";
  cipher.fields = [];
  return cipher;
}

const identityId = "1b9b2c1e-0000-4000-8000-000000000003";

function identityItem(): CipherView {
  const cipher = new CipherView();
  cipher.id = identityId;
  cipher.name = "Home";
  cipher.type = CipherType.Identity;
  cipher.viewPassword = true;
  cipher.identity = new IdentityView();
  cipher.identity.firstName = "Alice";
  cipher.identity.lastName = "Example";
  cipher.identity.city = "Springfield";
  cipher.identity.state = "CA";
  cipher.identity.country = "US";
  cipher.fields = [];
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
        ["s", "Never fill this field on this site"],
      ]);
      // Only the last is for every item on the site.
      expect(choicesFor(bankItem()).map((c) => !!c.siteWide)).toEqual([
        false,
        false,
        false,
        false,
        true,
      ]);
    });

    // C14: the menu's words come from the translations, upstream's for the
    // values and ours for the rest, and English for a word that has none.
    it("names the choices in the person's language", () => {
      const german: Record<string, string> = {
        username: "Benutzername",
        password: "Passwort",
        verificationCode: "Verifizierungscode",
      };
      const words = fillPickerWords({ t: (key: string) => german[key] ?? "" });
      const cipher = bankItem();
      cipher.login.totp = "JBSWY3DPEHPK3PXP";

      expect(choicesFor(cipher, words, true).map((c) => c.title)).toEqual([
        "Benutzername",
        "Passwort",
        "Verifizierungscode",
        "Customer ID",
        "Never fill this field",
        "Never fill this field on this site",
      ]);
      // The keys stay the same, so a pick means the same in any language.
      expect(choicesFor(cipher, words, true).map((c) => c.key)).toEqual(
        choicesFor(cipher, undefined, true).map((c) => c.key),
      );
    });

    // Two-step codes need Premium, or an organization that gives codes
    // (two-step-codes.ts): the picker offers an item's code only where it shows.
    it("offers the two-step code only where it shows", () => {
      const cipher = bankItem();
      cipher.login.totp = "JBSWY3DPEHPK3PXP";

      expect(choicesFor(cipher, undefined, true).map((c) => c.key)).toEqual([
        "u",
        "p",
        "t",
        "f0",
        "n",
        "s",
      ]);
      expect(choicesFor(cipher, undefined, false).map((c) => c.key)).toEqual([
        "u",
        "p",
        "f0",
        "n",
        "s",
      ]);
      // Unless told it shows, it doesn't.
      expect(choicesFor(cipher).map((c) => c.key)).toEqual(["u", "p", "f0", "n", "s"]);
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

      expect(choicesFor(cipher).map((c) => c.key)).toEqual(["u", "f0", "n", "s"]);
    });

    it("offers a card's name, number, expiry month and year, and security code", () => {
      expect(choicesFor(cardItem()).map((c) => [c.key, c.title, c.source])).toEqual([
        ["c0", "Cardholder name", { from: "card", value: "cardholderName" }],
        ["c1", "Number", { from: "card", value: "number" }],
        ["c2", "Expiration month", { from: "card", value: "expMonth" }],
        ["c3", "Expiration year", { from: "card", value: "expYear" }],
        ["c4", "Security code", { from: "card", value: "code" }],
        ["n", "Never fill this field", { from: "never" }],
        ["s", "Never fill this field on this site", { from: "never" }],
      ]);
    });

    it("offers a card's number and security code only to someone who can see them", () => {
      const card = cardItem();
      card.viewPassword = false;

      expect(choicesFor(card).map((c) => c.key)).toEqual(["c0", "c2", "c3", "n", "s"]);
    });

    it("offers an identity's names and address, and only the values it has", () => {
      expect(choicesFor(identityItem()).map((c) => [c.key, c.title])).toEqual([
        ["i0", "First name"],
        ["i2", "Last name"],
        ["i3", "Full name"],
        ["i10", "City / Town"],
        ["i11", "State / Province"],
        ["i13", "Country"],
        ["n", "Never fill this field"],
        ["s", "Never fill this field on this site"],
      ]);
    });

    it("names a card's and an identity's values in the person's language, upstream's words", () => {
      const german: Record<string, string> = {
        cardholderName: "Name des Karteninhabers",
        number: "Nummer",
        securityCode: "Sicherheitscode",
        cityTown: "Stadt oder Ort",
        keykeeperNeverFillThisFieldOnThisSite: "Dieses Feld auf dieser Website nie füllen",
      };
      const words = fillPickerWords({ t: (key: string) => german[key] ?? "" });

      expect(choicesFor(cardItem(), words).map((c) => c.title)).toEqual([
        "Name des Karteninhabers",
        "Nummer",
        "Expiration month",
        "Expiration year",
        "Sicherheitscode",
        "Never fill this field",
        "Dieses Feld auf dieser Website nie füllen",
      ]);
      expect(choicesFor(identityItem(), words).map((c) => c.title)).toContain("Stadt oder Ort");
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
        `${FILL_FIELD_ID}_${cipherId}_s`,
      ]);
      expect(created.every((p) => p.contexts?.length === 1 && p.contexts[0] === "editable")).toBe(
        true,
      );
      expect(createdFillFieldMenuIds.has(`${FILL_FIELD_ID}_${cipherId}_f0`)).toBe(true);
    });

    it("titles the menu in the person's language", async () => {
      const words = fillPickerWords({
        t: (key: string) =>
          ({
            keykeeperFillThisFieldWith: "Dieses Feld füllen mit",
            keykeeperNeverFillThisField: "Dieses Feld nie füllen",
            username: "Benutzername",
          })[key] ?? "",
      });

      await initFillFieldMenu(words);
      await addCipherToFillFieldMenu(bankItem(), words);

      const titles = createSpy.mock.calls.map(([props]) => props.title);
      expect(titles).toEqual([
        "Dieses Feld füllen mit",
        "Example Bank",
        "Benutzername",
        "Password",
        "Customer ID",
        undefined,
        "Dieses Feld nie füllen",
        "Never fill this field on this site",
      ]);
    });

    it("lists an item's two-step code only where it shows", async () => {
      const original = keykeeperFillPicker.showsTotp;
      const cipher = bankItem();
      cipher.login.totp = "JBSWY3DPEHPK3PXP";
      try {
        keykeeperFillPicker.showsTotp = async () => false;
        await addCipherToFillFieldMenu(cipher);
        const ids = () => createSpy.mock.calls.map(([props]) => props.id);
        expect(ids()).not.toContain(`${FILL_FIELD_ID}_${cipherId}_t`);

        createdFillFieldMenuIds.clear();
        createSpy.mockClear();
        keykeeperFillPicker.showsTotp = async () => true;
        await addCipherToFillFieldMenu(cipher);
        expect(ids()).toContain(`${FILL_FIELD_ID}_${cipherId}_t`);
      } finally {
        keykeeperFillPicker.showsTotp = original;
        createdFillFieldMenuIds.clear();
      }
    });

    it("adds cards and identities with their values", async () => {
      await addCipherToFillFieldMenu(cardItem());
      await addCipherToFillFieldMenu(identityItem());

      const ids = createSpy.mock.calls.map(([props]) => props.id);
      expect(ids).toContain(`${FILL_FIELD_ID}_${cardId}_c1`);
      expect(ids).toContain(`${FILL_FIELD_ID}_${cardId}_s`);
      expect(ids).toContain(`${FILL_FIELD_ID}_${identityId}_i10`);
      createdFillFieldMenuIds.clear();
    });

    it("ignores items that aren't logins, cards, or identities", async () => {
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
      openReprompt: jest.Mock<Promise<void>, [chrome.tabs.Tab, CipherView]>;
    };
    const originalMatches = keykeeperFillPicker.itemMatches;
    const originalShowsTotp = keykeeperFillPicker.showsTotp;
    const originalNeverFill = { ...keykeeperSiteNeverFill };
    const originalShare = keykeeperSiteFixes.share;
    /** The person's site-wide never-fill list, as the background keeps it. */
    let siteNever: FillRule[];
    /** Whether that list has room for another. */
    let siteNeverRoom: boolean;
    let shared: FillRule[];
    /** The right-clicked field. */
    let rightClicked: AutofillField;
    let tabSendMessage: jest.SpyInstance;
    /** The page or frame the right-clicked field is in. */
    let frameUrl: string;

    beforeEach(() => {
      cipher = bankItem();
      frameUrl = tab.url!;
      rightClicked = customerNumberField;
      siteNever = [];
      siteNeverRoom = true;
      shared = [];
      keykeeperSiteNeverFill.add = async (rule) => {
        if (!siteNeverRoom) {
          return false;
        }
        siteNever.push(rule);
        return true;
      };
      keykeeperSiteNeverFill.remove = async (rule) => {
        siteNever = siteNever.filter((r) => JSON.stringify(r) !== JSON.stringify(rule));
      };
      keykeeperSiteFixes.share = async (rule) => {
        shared.push(rule);
      };
      deps = {
        authService: mock<AuthService>(),
        accountService: {
          activeAccount$: new BehaviorSubject({ id: "user-1" }),
        } as unknown as AccountService,
        cipherService: mock<CipherService>(),
        totpService: mock<TotpService>(),
        passwordRepromptRequired: jest.fn<Promise<boolean>, [CipherView]>(async () => false),
        openReprompt: jest.fn<Promise<void>, [chrome.tabs.Tab, CipherView]>(async () => {}),
      };
      // As main.background sets it: the item's websites, by base domain.
      keykeeperFillPicker.itemMatches = async (c, url) =>
        c.login?.matchesUri(url, new Set(), UriMatchStrategy.Domain) ?? false;
      deps.authService.getAuthStatus.mockResolvedValue(AuthenticationStatus.Unlocked);
      deps.cipherService.getAllDecrypted.mockResolvedValue([cipher]);
      deps.cipherService.updateWithServer.mockImplementation(async (c) => c);
      deps.totpService.getCode$.mockReturnValue(of({ code: "123456", period: 30 }));
      tabSendMessage = jest
        .spyOn(BrowserApi, "tabSendMessage")
        .mockImplementation(async (_tab, message) => {
          if ((message as { command: string }).command === "collectAutofillTriage") {
            return {
              pageDetails: { url: frameUrl, fields: [rightClicked] },
              targetOpid: rightClicked.opid,
            };
          }
          return undefined;
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      keykeeperFillPicker.itemMatches = originalMatches;
      keykeeperFillPicker.showsTotp = originalShowsTotp;
      Object.assign(keykeeperSiteNeverFill, originalNeverFill);
      keykeeperSiteFixes.share = originalShare;
    });

    const clickFor = (id: string, key: string, frameId = 0) =>
      handleFillFieldMenuClick(
        {
          menuItemId: `${FILL_FIELD_ID}_${id}_${key}`,
          frameId,
        } as chrome.contextMenus.OnClickData,
        tab,
        deps,
      );
    const click = (key: string) => clickFor(cipherId, key);

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
            // Upstream's warnings: before an http page, and for a frame the item isn't for.
            requiresInsecurePageConfirmation: false,
            untrustedIframe: false,
          }),
        }),
        { frameId: 0 },
      );
      expect(deps.cipherService.updateWithServer).toHaveBeenCalledWith(cipher, "user-1");
      expect(readFillRules(cipher)).toEqual([
        {
          v: 1,
          host: "bank.example.test",
          scheme: "https",
          field: { id: "custno", name: "customer_number", label: "customer number" },
          fill: { from: "field", name: "Customer ID" },
        },
      ]);
    });

    const filled = () =>
      tabSendMessage.mock.calls.some(([, message]) => message.command === "fillForm");

    it("fills the item's current two-step code where it shows, and nothing where it doesn't", async () => {
      cipher.login.totp = "JBSWY3DPEHPK3PXP";

      keykeeperFillPicker.showsTotp = async () => false;
      expect(await click("t")).toBe(true);
      expect(filled()).toBe(false);
      expect(readFillRules(cipher)).toEqual([]);
      expect(deps.cipherService.updateWithServer).not.toHaveBeenCalled();

      keykeeperFillPicker.showsTotp = async () => true;
      expect(await click("t")).toBe(true);
      expect(tabSendMessage).toHaveBeenCalledWith(
        tab,
        expect.objectContaining({
          command: "fillForm",
          fillScript: expect.objectContaining({
            script: expect.arrayContaining([["fill_by_opid", "__3", "123456"]]),
          }),
        }),
        { frameId: 0 },
      );
      expect(readFillRules(cipher)[0].fill).toEqual({ from: "totp" });
    });

    it("drops a two-step code pick waiting for the master password if codes stopped showing meanwhile", async () => {
      cipher.login.totp = "JBSWY3DPEHPK3PXP";
      deps.passwordRepromptRequired.mockResolvedValue(true);
      keykeeperFillPicker.showsTotp = async () => true;
      await click("t");
      keykeeperFillPicker.showsTotp = async () => false;

      expect(await finishPickAfterReprompt(cipherId, true)).toBe(false);
      expect(filled()).toBe(false);
      expect(readFillRules(cipher)).toEqual([]);
    });

    it("asks for the master password first for any value of an item that wants it, and saves nothing until then", async () => {
      deps.passwordRepromptRequired.mockResolvedValue(true);

      for (const key of ["u", "p", "f0", "n"]) {
        await click(key);
      }

      expect(filled()).toBe(false);
      expect(readFillRules(cipher)).toEqual([]);
      expect(deps.cipherService.updateWithServer).not.toHaveBeenCalled();
      expect(deps.openReprompt).toHaveBeenCalledTimes(4);
      expect(deps.openReprompt).toHaveBeenCalledWith(tab, cipher);
    });

    it("goes ahead with the pick once the prompt succeeds, and drops it when it doesn't", async () => {
      deps.passwordRepromptRequired.mockResolvedValue(true);

      await click("p");
      expect(await finishPickAfterReprompt(cipherId, false)).toBe(false);
      // A failed prompt dropped the pick: a later success finds nothing.
      expect(await finishPickAfterReprompt(cipherId, true)).toBe(false);
      expect(filled()).toBe(false);
      expect(readFillRules(cipher)).toEqual([]);

      await click("p");
      expect(await finishPickAfterReprompt(cipherId, true)).toBe(true);
      expect(filled()).toBe(true);
      expect(readFillRules(cipher)[0].fill).toEqual({ from: "password" });
      expect(deps.cipherService.updateWithServer).toHaveBeenCalledTimes(1);
    });

    it("drops a pick the prompt answers after five minutes", async () => {
      deps.passwordRepromptRequired.mockResolvedValue(true);

      await click("u");

      expect(await finishPickAfterReprompt(cipherId, true, Date.now() + 5 * 60 * 1000 + 1)).toBe(
        false,
      );
      expect(filled()).toBe(false);
    });

    it("never puts a secret into a frame the item isn't for, and remembers nothing", async () => {
      frameUrl = "https://ads.example.net/frame";

      await click("p");

      expect(filled()).toBe(false);
      expect(readFillRules(cipher)).toEqual([]);
      expect(deps.cipherService.updateWithServer).not.toHaveBeenCalled();
    });

    it("never puts a secret into a page of the same site the item's websites don't match", async () => {
      cipher.login.uris[0].match = UriMatchStrategy.Exact;
      frameUrl = "https://bank.example.test/other";

      await click("p");

      expect(filled()).toBe(false);
    });

    it("asks first before filling anything else into a frame the item isn't for, as upstream does", async () => {
      frameUrl = "https://ads.example.net/frame";

      await click("u");

      expect(tabSendMessage).toHaveBeenCalledWith(
        tab,
        expect.objectContaining({
          command: "fillForm",
          fillScript: expect.objectContaining({ untrustedIframe: true }),
        }),
        { frameId: 0 },
      );
    });

    it("never shows a hidden value in a plain field to someone who can't see passwords, even through a field of the same name", async () => {
      const pin = new FieldView();
      pin.name = "Customer ID";
      pin.value = "hidden-pin";
      pin.type = FieldType.Hidden;
      cipher.fields = [pin, ...cipher.fields];
      cipher.viewPassword = false;

      // The visible "Customer ID" is the only one offered (f1, after the
      // hidden one), but a rule names fields by name.
      expect(choicesFor(cipher).map((c) => c.key)).toContain("f1");
      expect(choicesFor(cipher).map((c) => c.key)).not.toContain("f0");
      await click("f1");

      expect(filled()).toBe(false);
      expect(readFillRules(cipher)).toEqual([]);
    });

    it("asks first before filling an http page of a site the item has as https, as upstream does", async () => {
      frameUrl = "http://bank.example.test/login";

      await click("u");

      expect(tabSendMessage).toHaveBeenCalledWith(
        tab,
        expect.objectContaining({
          command: "fillForm",
          fillScript: expect.objectContaining({ requiresInsecurePageConfirmation: true }),
        }),
        { frameId: 0 },
      );
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

    it("keeps never-fill on this site in the person's settings, for every item, not on the item", async () => {
      await click("s");

      expect(filled()).toBe(false);
      // Only what decides the field (its id), on the site it was made on.
      expect(siteNever).toEqual([
        {
          v: 1,
          host: "bank.example.test",
          scheme: "https",
          field: { id: "custno" },
          fill: { from: "never" },
        },
      ]);
      expect(readFillRules(cipher)).toEqual([]);
      expect(deps.cipherService.updateWithServer).not.toHaveBeenCalled();
      // Shared as a "never" fix, for people who share theirs.
      expect(shared.map((r) => r.fill)).toEqual([{ from: "never" }]);
    });

    it("keeps never-fill on this site on the item when the person's list is full", async () => {
      siteNeverRoom = false;

      await click("s");

      expect(siteNever).toEqual([]);
      expect(readFillRules(cipher)[0].fill).toEqual({ from: "never" });
      expect(deps.cipherService.updateWithServer).toHaveBeenCalledWith(cipher, "user-1");
    });

    it("asks for the master password before never-fill on this site, and keeps nothing until then", async () => {
      deps.passwordRepromptRequired.mockResolvedValue(true);

      await click("s");
      expect(siteNever).toEqual([]);

      expect(await finishPickAfterReprompt(cipherId, true)).toBe(false);
      expect(siteNever).toHaveLength(1);
    });

    it("takes a field off the site-wide never-fill list when a value is picked for it", async () => {
      siteNever = [
        {
          v: 1,
          host: "bank.example.test",
          scheme: "https",
          field: { id: "custno" },
          fill: { from: "never" },
        },
        {
          v: 1,
          host: "bank.example.test",
          scheme: "https",
          field: { id: "other" },
          fill: { from: "never" },
        },
      ];

      await click("f0");

      expect(filled()).toBe(true);
      expect(siteNever.map((r) => r.field)).toEqual([{ id: "other" }]);
    });

    describe("cards and identities", () => {
      const cardNumberField = {
        opid: "__9",
        htmlID: "cardnumber",
        type: "text",
        viewable: true,
        "label-tag": "Card number",
      } as AutofillField;
      let card: CipherView;
      let identity: CipherView;

      beforeEach(() => {
        card = cardItem();
        identity = identityItem();
        deps.cipherService.getAllDecrypted.mockResolvedValue([cipher, card, identity]);
        rightClicked = cardNumberField;
      });

      const fillValue = () =>
        tabSendMessage.mock.calls
          .filter(([, message]) => message.command === "fillForm")
          .map(([, message]) => message.fillScript.script.at(-1)?.[2]);

      it("fills a card's number into the shop's own page and remembers it on the card", async () => {
        frameUrl = tab.url!;

        await clickFor(cardId, "c1");

        expect(fillValue()).toEqual(["4111111111111111"]);
        expect(readFillRules(card)).toEqual([
          {
            v: 1,
            host: "bank.example.test",
            scheme: "https",
            field: { id: "cardnumber", label: "card number" },
            fill: { from: "card", value: "number" },
          },
        ]);
        expect(deps.cipherService.updateWithServer).toHaveBeenCalledWith(card, "user-1");
      });

      it("fills a card's value into a payment service's frame", async () => {
        frameUrl = "https://js.stripe.com/v3/elements-inner-card.html";

        await clickFor(cardId, "c1", 5);

        expect(fillValue()).toEqual(["4111111111111111"]);
        expect(tabSendMessage).toHaveBeenCalledWith(
          tab,
          expect.objectContaining({
            command: "fillForm",
            fillScript: expect.objectContaining({ untrustedIframe: false }),
          }),
          { frameId: 5 },
        );
        expect(readFillRules(card)[0].host).toBe("js.stripe.com");
      });

      it("never puts a card's value into another site's frame, even its name, and remembers nothing", async () => {
        frameUrl = "https://widgets.example.net/form";

        await clickFor(cardId, "c1", 6);
        await clickFor(cardId, "c0", 6);

        expect(filled()).toBe(false);
        expect(readFillRules(card)).toEqual([]);
        expect(deps.cipherService.updateWithServer).not.toHaveBeenCalled();
      });

      it("fills a frame of the shop's own site", async () => {
        frameUrl = "https://pay.example.test/card";

        await clickFor(cardId, "c4", 3);

        expect(fillValue()).toEqual(["123"]);
      });

      it("never fills a card's number or code for someone who can't see them", async () => {
        card.viewPassword = false;
        rightClicked = { ...cardNumberField, type: "password" };

        await clickFor(cardId, "c1");
        await clickFor(cardId, "c4");

        expect(filled()).toBe(false);
        expect(readFillRules(card)).toEqual([]);
      });

      it("chooses a month list's option, and writes a month as two digits in a text field", async () => {
        rightClicked = {
          opid: "__10",
          htmlID: "exp-month",
          type: "select-one",
          viewable: true,
          selectInfo: {
            options: [
              ["january", "01"],
              ["february", "02"],
              ["march", "03"],
            ],
          },
        } as AutofillField;
        await clickFor(cardId, "c2");

        rightClicked = {
          opid: "__11",
          htmlID: "mm",
          type: "text",
          viewable: true,
        } as AutofillField;
        await clickFor(cardId, "c2");

        expect(fillValue()).toEqual(["03", "03"]);
      });

      it("fills an identity's values into any frame, as upstream's identity fill does", async () => {
        frameUrl = "https://address.example.net/form";
        rightClicked = {
          opid: "__12",
          htmlID: "town",
          type: "text",
          viewable: true,
        } as AutofillField;

        await clickFor(identityId, "i10", 4);

        expect(fillValue()).toEqual(["Springfield"]);
        expect(readFillRules(identity)[0].fill).toEqual({ from: "identity", value: "city" });
      });

      it("keeps an identity's hidden field out of another site's frame", async () => {
        const secret = new FieldView();
        secret.name = "Member PIN";
        secret.value = "9999";
        secret.type = FieldType.Hidden;
        identity.fields = [secret];
        frameUrl = "https://address.example.net/form";
        rightClicked = {
          opid: "__13",
          htmlID: "pin",
          type: "password",
          viewable: true,
        } as AutofillField;

        await clickFor(identityId, "f0", 4);
        expect(filled()).toBe(false);

        frameUrl = tab.url!;
        await clickFor(identityId, "f0", 0);
        expect(fillValue()).toEqual(["9999"]);
      });
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
  describe("labelSuggestion", () => {
    const page = "https://bank.example.test/login";
    const customerNumber = {
      opid: "__3",
      htmlID: "custno",
      htmlName: "customer_number",
      type: "text",
      viewable: true,
      "label-tag": "Customer number",
    } as AutofillField;
    const details = (field: AutofillField, url = page) =>
      ({ url, fields: [field], forms: {} }) as unknown as AutofillPageDetails;
    const original = { ...keykeeperFillPicker };
    const originalNeverFill = { ...keykeeperSiteNeverFill };
    let siteNever: FillRule[];

    beforeEach(() => {
      siteNever = [];
      keykeeperFillPicker.itemMatches = async (c, url) =>
        c.login?.matchesUri(url, new Set(), UriMatchStrategy.Domain) ?? false;
      keykeeperFillPicker.excluded = AutofillService.isExcludedFromFillRules;
      keykeeperSiteNeverFill.rulesFor = async () => siteNever;
    });

    afterEach(() => {
      Object.assign(keykeeperFillPicker, original);
      Object.assign(keykeeperSiteNeverFill, originalNeverFill);
    });

    const suggest = (cipher: CipherView, field: AutofillField, url = page) =>
      labelSuggestion(cipher, field, details(field, url));

    it("offers the custom field whose name matches the label, as the picker's own choice", async () => {
      const suggestion = await suggest(bankItem(), customerNumber);

      expect(suggestion).toEqual({
        key: "f0",
        title: "Fill Customer ID here?",
        source: { from: "field", name: "Customer ID" },
      });
    });

    it("says it in the person's language", async () => {
      const words = fillPickerWords({
        t: (key: string, name?: string) =>
          key === "keykeeperFillHere" ? `${name} hier einfügen?` : "",
      });

      const suggestion = await labelSuggestion(
        bankItem(),
        customerNumber,
        details(customerNumber),
        words,
      );

      expect(suggestion?.title).toBe("Customer ID hier einfügen?");
    });

    it("offers nothing for a login that isn't for the page or frame", async () => {
      expect(
        await suggest(bankItem(), customerNumber, "https://phish.example.net/login"),
      ).toBeNull();
    });

    it("offers nothing on a label of generic words only", async () => {
      const cipher = bankItem();
      cipher.fields[0].name = "ID";
      expect(await suggest(cipher, { ...customerNumber, "label-tag": "Number" })).toBeNull();
      cipher.fields[0].name = "Code";
      expect(await suggest(cipher, { ...customerNumber, "label-tag": "Code" })).toBeNull();
    });

    it("offers nothing where upstream fills the custom field by its name anyway", async () => {
      expect(
        await suggest(bankItem(), { ...customerNumber, "label-tag": "Customer ID" }),
      ).toBeNull();
      expect(await suggest(bankItem(), { ...customerNumber, htmlName: "customer id" })).toBeNull();
    });

    it("offers nothing where a rule of the login's, or never-fill on this site, decides", async () => {
      const cipher = bankItem();
      upsert(cipher, {
        v: 1,
        host: "bank.example.test",
        field: { id: "custno" },
        fill: { from: "username" },
      });
      expect(await suggest(cipher, customerNumber)).toBeNull();

      siteNever = [
        { v: 1, host: "bank.example.test", field: { id: "custno" }, fill: { from: "never" } },
      ];
      expect(await suggest(bankItem(), customerNumber)).toBeNull();
    });

    it("offers nothing on a field upstream's autofill leaves alone, can't be seen, or isn't typed into", async () => {
      expect(await suggest(bankItem(), { ...customerNumber, type: "search" })).toBeNull();
      expect(await suggest(bankItem(), { ...customerNumber, viewable: false })).toBeNull();
      expect(await suggest(bankItem(), { ...customerNumber, type: "checkbox" })).toBeNull();
      expect(await suggest(bankItem(), { ...customerNumber, readonly: true })).toBeNull();
    });

    it("offers nothing when two custom fields match", async () => {
      const cipher = bankItem();
      const second = new FieldView();
      second.name = "Customer No.";
      second.value = "C-999";
      second.type = FieldType.Text;
      cipher.fields = [...cipher.fields, second];

      expect(await suggest(cipher, customerNumber)).toBeNull();
    });

    it("offers a hidden field only to someone who can see passwords, and only for a password field", async () => {
      const cipher = bankItem();
      cipher.viewPassword = true;
      cipher.fields[0].type = FieldType.Hidden;

      expect(await suggest(cipher, customerNumber)).toBeNull();
      expect((await suggest(cipher, { ...customerNumber, type: "password" }))?.key).toBe("f0");

      cipher.viewPassword = false;
      expect(await suggest(cipher, { ...customerNumber, type: "password" })).toBeNull();
    });

    it("offers nothing for cards and identities, which fill by their own values", async () => {
      expect(await suggest(cardItem(), customerNumber)).toBeNull();
    });
  });
});
