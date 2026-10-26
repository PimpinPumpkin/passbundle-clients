import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { BehaviorSubject, of } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import {
  RestrictedCipherType,
  RestrictedItemTypesService,
} from "@bitwarden/common/vault/services/restricted-item-types.service";
import { DIALOG_DATA, DialogRef } from "@bitwarden/components";

import { mockAccountServiceWith } from "../../../common/spec";

import { KeykeeperNewItemDialogComponent, NewItemDialogData } from "./new-item-dialog.component";

describe("KeykeeperNewItemDialogComponent", () => {
  beforeAll(() => {
    // The dialog's scroll shadow watches its content; jsdom has no observer.
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });

  let fixture: ComponentFixture<KeykeeperNewItemDialogComponent>;
  let data: NewItemDialogData;
  const close = jest.fn();
  const restricted$ = new BehaviorSubject<RestrictedCipherType[]>([]);
  const newItemTypes$ = new BehaviorSubject(false);
  let items: unknown[] = [];

  const everything: NewItemDialogData = {
    canCreateCipher: true,
    canCreateFolder: true,
    canCreateCollection: true,
    canCreateSshKey: true,
  };

  async function open(dialogData: NewItemDialogData = everything) {
    data = dialogData;
    await TestBed.configureTestingModule({
      imports: [KeykeeperNewItemDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useFactory: () => data },
        { provide: RestrictedItemTypesService, useValue: { restricted$ } },
        { provide: ConfigService, useValue: { getFeatureFlag$: () => newItemTypes$ } },
        { provide: AccountService, useValue: mockAccountServiceWith("user" as UserId) },
        { provide: CipherService, useValue: { getAllDecrypted: async () => items } },
        { provide: OrganizationService, useValue: { organizations$: () => of([]) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperNewItemDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const buttons = () => Array.from(el().querySelectorAll("button"));
  const button = (text: string) =>
    buttons().find((b) => b.textContent?.replace(/\s+/g, " ").trim().startsWith(text));
  const mainTiles = () =>
    Array.from(el().querySelectorAll("[data-testid=new-item-main] button")).map((b) =>
      Array.from(b.querySelectorAll(":scope > span"))
        .map((span) => span.textContent?.trim())
        .join(" "),
    );
  const moreOpen = async () => {
    button("More categories")!.click();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    close.mockClear();
    restricted$.next([]);
    newItemTypes$.next(false);
    items = [];
  });

  it("shows the four kinds people save most as big tiles, and folders and collections at the bottom", async () => {
    await open();

    expect(mainTiles()).toEqual([
      "typeLogin typeLoginSubtitle",
      "typeSecureNote typeNoteSubtitle",
      "typeCard typeCardSubtitle",
      "typeIdentity typeIdentitySubtitle",
    ]);
    // Each with its category's jewel tile, as in the menu and the list.
    expect(
      Array.from(el().querySelectorAll("[data-testid=new-item-main] [data-jewel]")).map((t) =>
        t.getAttribute("data-category"),
      ),
    ).toEqual(["login", "note", "card", "identity"]);
    button("typeLogin")!.click();
    expect(close).toHaveBeenCalledWith({ kind: "type", cipherType: CipherType.Login });
    button("folder")!.click();
    expect(close).toHaveBeenCalledWith({ kind: "folder" });
    button("collection")!.click();
    expect(close).toHaveBeenCalledWith({ kind: "collection" });
  });

  it("keeps the rest under More: other kinds and the built-in templates, by name", async () => {
    await open();
    expect(button("API key")).toBeUndefined();

    await moreOpen();

    expect(button("typeSshKey")).toBeDefined();
    button("API key")!.click();
    expect(close).toHaveBeenCalledWith({
      kind: "template",
      template: expect.objectContaining({ id: "api-key" }),
    });
    button("Server")!.click();
    expect(close).toHaveBeenLastCalledWith(
      expect.objectContaining({ template: expect.objectContaining({ id: "server" }) }),
    );
  });

  it("finds a category by name", async () => {
    await open();
    await moreOpen();
    const search = el().querySelector<HTMLInputElement>("#new-item-search")!;

    search.value = "wi-f";
    search.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    expect(button("Wi-Fi network")).toBeDefined();
    // A template with its own color shows it; the rest show their kind's.
    expect(
      button("Wi-Fi network")!.querySelector("[data-jewel]")!.getAttribute("data-category"),
    ).toBe("wifi");
    expect(button("API key")).toBeUndefined();

    search.value = "nothing like this";
    search.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    expect(el().textContent).toContain("No category matches that.");
  });

  it("offers the person's own templates, and making new ones", async () => {
    items = [
      {
        id: "t1",
        name: "Alarm code",
        organizationId: null,
        type: CipherType.SecureNote,
        deletedDate: null,
        fields: [
          {
            name: "keykeeper.template-definition",
            value: JSON.stringify({ id: "alarm", base: "note", v: 1 }),
            type: FieldType.Text,
          },
          { name: "Code", value: "", type: FieldType.Hidden },
        ],
      },
    ];
    await open();
    await moreOpen();

    expect(el().textContent).toContain("My templates");
    button("Alarm code")!.click();
    expect(close).toHaveBeenCalledWith({
      kind: "template",
      template: expect.objectContaining({ name: "Alarm code" }),
    });
    button("a template for logins")!.click();
    expect(close).toHaveBeenCalledWith({ kind: "createTemplate", base: "login" });
  });

  it("leaves out kinds the person can't make", async () => {
    restricted$.next([{ cipherType: CipherType.Card, allowViewOrgIds: [] }]);
    await open({ ...everything, canCreateSshKey: false, canCreateCollection: false });
    await moreOpen();

    expect(mainTiles()).not.toContain("typeCard typeCardSubtitle");
    expect(button("typeSshKey")).toBeUndefined();
    expect(button("collection")).toBeUndefined();
  });

  it("offers bank accounts, driver's licenses, and passports where the server has them", async () => {
    newItemTypes$.next(true);
    await open();
    await moreOpen();

    expect(button("typeBankAccount")).toBeDefined();
    expect(button("typePassport")).toBeDefined();
  });
});
