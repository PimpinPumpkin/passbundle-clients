import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { TaskService } from "@bitwarden/common/vault/tasks";
import { DialogRef, DialogService, ToastService } from "@bitwarden/components";

import { CipherFormConfig } from "../cipher-form/abstractions/cipher-form-config.service";

import { ItemHistoryResponse, VersionEditor } from "./item-versions";
import { KeykeeperItemVersionsComponent } from "./item-versions.component";
import { KeykeeperVersionDialogComponent, VersionDialogData } from "./version-dialog.component";

function login(password: string, overrides: Partial<CipherView> = {}) {
  const item = new CipherView();
  item.id = "item-1";
  item.type = CipherType.Login;
  item.name = "Mail";
  item.login = new LoginView();
  item.login.password = password;
  item.revisionDate = new Date("2026-10-23T10:00:00Z");
  item.edit = true;
  item.viewPassword = true;
  return Object.assign(item, overrides);
}

const version = (id: string, cipher: unknown) => ({
  object: "keykeeperCipherVersion" as const,
  id,
  revisionDate: "2026-10-22T10:00:00Z",
  savedBy: { id: "ana", name: "Ana", email: "ana@example.test" },
  replacedDate: "2026-10-23T10:00:00Z",
  replacedBy: null as VersionEditor | null,
  cipher,
});

describe("KeykeeperItemVersionsComponent", () => {
  let fixture: ComponentFixture<KeykeeperItemVersionsComponent>;
  const apiService = mock<ApiService>();
  const cipherService = mock<CipherService>();
  const dialogService = mock<DialogService>();
  let response: ItemHistoryResponse;
  let openDialog: jest.SpyInstance;

  const history = (
    data: ItemHistoryResponse["data"],
    hidePasswords = false,
  ): ItemHistoryResponse => ({
    object: "keykeeperCipherHistory",
    cipherId: "item-1",
    revisionDate: "2026-10-23T10:00:00Z",
    savedBy: null,
    hidePasswords,
    data,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    apiService.send.mockImplementation(async (method) => (method === "GET" ? response : null));
    // Each version decrypts to the login its stand-in names.
    cipherService.decrypt.mockImplementation(async (cipher) =>
      login(String(cipher.name?.encryptedString)),
    );
    openDialog = jest
      .spyOn(KeykeeperVersionDialogComponent, "open")
      .mockReturnValue({ closed: of(undefined) } as unknown as DialogRef<any, any>);

    await TestBed.configureTestingModule({
      imports: [KeykeeperItemVersionsComponent],
      providers: [
        { provide: ApiService, useValue: apiService },
        { provide: CipherService, useValue: cipherService },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "ana" }) } },
        { provide: DialogService, useValue: dialogService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
        { provide: TaskService, useValue: mock<TaskService>() },
      ],
    }).compileComponents();
  });

  async function render(
    current: CipherView,
    inputs: { canEdit?: boolean; canDelete?: boolean } = {},
  ) {
    fixture = TestBed.createComponent(KeykeeperItemVersionsComponent);
    fixture.componentRef.setInput("cipher", current);
    fixture.componentRef.setInput("formConfig", {
      originalCipher: {},
    } as unknown as CipherFormConfig);
    fixture.componentRef.setInput("canEdit", inputs.canEdit ?? true);
    fixture.componentRef.setInput("canDelete", inputs.canDelete ?? false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const buttons = (el: HTMLElement, text: string) =>
    Array.from(el.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

  it("lists the item's earlier versions, says who can see them, and opens one", async () => {
    response = history([version("v2", { name: "two" }), version("v1", { name: "one" })]);
    const el = await render(login("three"));

    expect(el.querySelectorAll('[data-testid="keykeeper-item-version"]')).toHaveLength(2);
    expect(el.textContent).toContain("keykeeperVersionHistoryWhoSees");
    expect(buttons(el, "keykeeperClearHistory")).toHaveLength(0);

    buttons(el, "view")[0].click();
    const data: VersionDialogData = openDialog.mock.calls[0][1];
    expect(data.version.login.password).toBe("two");
    expect(data.restore).toEqual(expect.any(Function));
    expect(data.delete).toBeUndefined();
  });

  it("never opens a version for someone who can't see the item's passwords, whatever the server sends", async () => {
    response = history([version("v1", { name: "one" })]);
    const el = await render(login("two", { viewPassword: false }));
    expect(el.querySelectorAll('[data-testid="keykeeper-item-version"]')).toHaveLength(1);
    expect(buttons(el, "view")).toHaveLength(0);
    expect(cipherService.decrypt).not.toHaveBeenCalled();
  });

  it("lists only when and by whom when the server sends no fields, with nothing to view", async () => {
    response = history([version("v2", null), version("v1", null)], true);
    const el = await render(login("three", { viewPassword: false }));

    expect(el.querySelectorAll('[data-testid="keykeeper-item-version"]')).toHaveLength(2);
    expect(el.textContent).toContain("keykeeperVersionHistoryHiddenPasswords");
    expect(el.textContent).toContain("keykeeperSavedBy");
    expect(buttons(el, "view")).toHaveLength(0);
    expect(cipherService.decrypt).not.toHaveBeenCalled();
  });

  it("clears the history for people who can delete the item, once they confirm", async () => {
    response = history([version("v1", { name: "one" })]);
    const el = await render(login("two"), { canDelete: true });
    dialogService.openSimpleDialog.mockResolvedValue(true);

    buttons(el, "keykeeperClearHistory")[0].click();
    await fixture.whenStable();

    expect(apiService.send).toHaveBeenCalledWith(
      "DELETE",
      "/keykeeper/ciphers/item-1/history",
      null,
      true,
      false,
    );

    buttons(el, "view")[0].click();
    expect((openDialog.mock.calls[0][1] as VersionDialogData).delete).toEqual(expect.any(Function));
  });

  it("shows nothing while the item has no earlier versions", async () => {
    response = history([]);
    const el = await render(login("one"));
    expect(el.querySelector('[data-testid="keykeeper-item-versions"]')).toBeNull();
  });
});
