import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { convertToParamMap, ActivatedRoute } from "@angular/router";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherRepromptType, CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { Fido2CredentialView } from "@bitwarden/common/vault/models/view/fido2-credential.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { DialogService, ToastService } from "@bitwarden/components";
import {
  CipherFormConfig,
  CipherFormConfigService,
  DefaultCipherFormService,
  KeykeeperItemHistoryService,
  KeykeeperItemTileComponent,
  PasswordRepromptService,
} from "@bitwarden/vault";

import { PopupFooterComponent } from "../../../../../platform/popup/layout/popup-footer.component";
import { PopupHeaderComponent } from "../../../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../../../platform/popup/layout/popup-page.component";
import { PopupRouterCacheService } from "../../../../../platform/popup/view-cache/popup-router-cache.service";

import { KeykeeperItemHistoryPageComponent } from "./item-history-page.component";

@Component({
  selector: "popup-page",
  template: `<ng-content select="[slot=header]"></ng-content><ng-content></ng-content
    ><ng-content select="[slot=footer]"></ng-content>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PopupPageStubComponent {}

@Component({
  selector: "popup-header",
  template: `<h1>{{ pageTitle() }}</h1>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PopupHeaderStubComponent {
  readonly pageTitle = input("");
  readonly showBackButton = input<unknown>();
  readonly backAction = input<unknown>();
}

@Component({
  selector: "popup-footer",
  template: `<footer>
    <ng-content></ng-content><ng-content select="[slot=end]"></ng-content>
  </footer>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class PopupFooterStubComponent {}

@Component({
  selector: "vault-keykeeper-item-tile",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ItemTileStubComponent {
  readonly cipher = input<unknown>();
  readonly tileSize = input<unknown>();
}

function login(password: string, overrides: Partial<CipherView> = {}) {
  const item = new CipherView();
  item.id = "item-1";
  item.type = CipherType.Login;
  item.name = "Mail";
  item.login = new LoginView();
  item.login.username = "ana@example.test";
  item.login.password = password;
  item.revisionDate = new Date("2026-10-26T10:00:00Z");
  item.edit = true;
  item.viewPassword = true;
  return Object.assign(item, overrides);
}

function passkey(credentialId: string) {
  const p = new Fido2CredentialView();
  p.credentialId = credentialId;
  p.rpId = "shop.example.test";
  p.userName = "ana";
  p.counter = 1;
  return p;
}

const version = (id: string, cipher: unknown, savedBy = { id: "bo", name: "Bo", email: "" }) => ({
  object: "keykeeperCipherVersion",
  id,
  revisionDate: "2026-10-22T10:00:00Z",
  savedBy,
  replacedDate: "2026-10-23T10:00:00Z",
  replacedBy: null as unknown,
  cipher,
});

describe("KeykeeperItemHistoryPageComponent", () => {
  let fixture: ComponentFixture<KeykeeperItemHistoryPageComponent>;
  const apiService = mock<ApiService>();
  const cipherService = mock<CipherService>();
  const collectionService = mock<CollectionService>();
  const organizationService = mock<OrganizationService>();
  const repromptService = mock<PasswordRepromptService>();
  const routerCache = mock<PopupRouterCacheService>();
  const dialogService = mock<DialogService>();
  const toastService = mock<ToastService>();
  const formService = mock<DefaultCipherFormService>();
  const formConfigService = mock<CipherFormConfigService>();
  const config = { mode: "edit" } as CipherFormConfig;

  let current: CipherView;
  let versions: unknown[];
  let hidePasswords: boolean;
  let collections: CollectionView[];
  let versionsById: Record<string, CipherView>;

  const folder = (grid: Record<string, boolean>) =>
    Object.assign(
      new CollectionView({ id: "col-1", organizationId: "org-1", name: "Everyone" } as any),
      {
        readOnly: false,
        hidePasswords: false,
        manage: false,
        keykeeper: {
          seePasswords: false,
          create: false,
          edit: false,
          delete: false,
          export: false,
          share: false,
          print: false,
          viewHistory: false,
          manage: false,
          ...grid,
        },
      },
    );

  beforeEach(() => {
    jest.clearAllMocks();
    current = login("third");
    hidePasswords = false;
    collections = [];
    versionsById = { v2: login("second"), v1: login("first") };
    versions = [version("v2", { name: "v2" }), version("v1", { name: "v1" })];
    apiService.send.mockImplementation(async (method) =>
      method === "GET"
        ? {
            object: "keykeeperCipherHistory",
            cipherId: "item-1",
            revisionDate: "2026-10-26T10:00:00Z",
            savedBy: null,
            hidePasswords,
            // Versions of this item, where it is now, as the server sends them.
            data: versions.map((v: any) =>
              v.cipher == null
                ? v
                : {
                    ...v,
                    cipher: { id: current.id, organizationId: current.organizationId, ...v.cipher },
                  },
            ),
          }
        : null,
    );
    cipherService.cipherViews$.mockImplementation(() => of([current]) as any);
    cipherService.decrypt.mockImplementation(
      async (cipher) => versionsById[String(cipher.name?.encryptedString)],
    );
    collectionService.decryptedCollections$.mockImplementation(() => of(collections) as any);
    organizationService.organizations$.mockImplementation(() => of([] as Organization[]) as any);
    repromptService.passwordRepromptCheck.mockResolvedValue(true);
    dialogService.openSimpleDialog.mockResolvedValue(true);
    formConfigService.buildConfig.mockResolvedValue(config);
    formService.saveCipher.mockImplementation(async (cipher) => cipher);
  });

  async function render(): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [KeykeeperItemHistoryPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ cipherId: "item-1" }) } },
        },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "ana" }) } },
        { provide: ApiService, useValue: apiService },
        { provide: CipherService, useValue: cipherService },
        { provide: CollectionService, useValue: collectionService },
        { provide: OrganizationService, useValue: organizationService },
        { provide: PasswordRepromptService, useValue: repromptService },
        { provide: PopupRouterCacheService, useValue: routerCache },
        { provide: DialogService, useValue: dialogService },
        { provide: ToastService, useValue: toastService },
        { provide: LogService, useValue: mock<LogService>() },
        {
          provide: I18nService,
          useValue: { t: (key: string, ...args: unknown[]) => [key, ...args].join(" ") },
        },
      ],
    })
      .overrideComponent(KeykeeperItemHistoryPageComponent, {
        remove: {
          imports: [
            PopupPageComponent,
            PopupHeaderComponent,
            PopupFooterComponent,
            KeykeeperItemTileComponent,
          ],
        },
        add: {
          imports: [
            PopupPageStubComponent,
            PopupHeaderStubComponent,
            PopupFooterStubComponent,
            ItemTileStubComponent,
          ],
        },
      })
      .overrideComponent(KeykeeperItemHistoryPageComponent, {
        set: {
          providers: [
            KeykeeperItemHistoryService,
            { provide: DefaultCipherFormService, useValue: formService },
            { provide: CipherFormConfigService, useValue: formConfigService },
          ],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(KeykeeperItemHistoryPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const buttons = (el: HTMLElement, text: string) =>
    Array.from(el.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);
  const rows = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-testid="keykeeper-item-version"]'));

  it("lists the earlier versions, newest first, with who saved each and what changed", async () => {
    const el = await render();
    expect(rows(el)).toHaveLength(2);
    expect(rows(el)[0].textContent).toContain("keykeeperSavedBy Bo");
    expect(rows(el)[0].textContent).toContain("keykeeperOneChange");
    expect(el.textContent).toContain("keykeeperVersionHistoryWhoSees");
    // The person's own item: Clear is theirs.
    expect(buttons(el, "keykeeperClearHistory")).toHaveLength(1);
  });

  it("asks for the master password before an item that asks for it shows its history", async () => {
    current = login("third", { reprompt: CipherRepromptType.Password });
    repromptService.passwordRepromptCheck.mockResolvedValue(false);
    const el = await render();
    expect(repromptService.passwordRepromptCheck).toHaveBeenCalledWith(current);
    expect(apiService.send).not.toHaveBeenCalled();
    expect(routerCache.back).toHaveBeenCalled();
    expect(rows(el)).toHaveLength(0);
  });

  it("shows a version beside the item now, its password masked until shown", async () => {
    const el = await render();
    rows(el)[1].querySelector("button")!.click();
    await settle();

    const password = Array.from(el.querySelectorAll('[role="row"]')).find((r) =>
      r.textContent?.includes("password"),
    )!;
    expect(password.getAttribute("data-changed")).toBe("true");
    expect(password.textContent).not.toContain("first");
    expect(password.textContent).toContain("••••••••");

    buttons(el, "keykeeperShowHiddenValues")[0].click();
    await settle();
    const cells = password.querySelectorAll('[role="cell"]');
    expect(cells[0].textContent?.trim()).toBe("first");
    expect(cells[1].textContent?.trim()).toBe("third");
  });

  it("restores a version as a normal edit of the item as it is now, then goes back", async () => {
    const el = await render();
    rows(el)[1].querySelector("button")!.click();
    await settle();
    buttons(el, "keykeeperRestoreVersion")[0].click();
    await settle();

    expect(dialogService.openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ key: "keykeeperRestoreVersionDesc" }),
      }),
    );
    expect(formConfigService.buildConfig).toHaveBeenCalledWith("edit", "item-1", CipherType.Login);
    const [saved, savedConfig] = formService.saveCipher.mock.calls[0];
    expect(saved.login.password).toBe("first");
    // The revision it replaces, which the server checks so a newer edit isn't lost.
    expect(saved.revisionDate).toEqual(current.revisionDate);
    expect(savedConfig).toBe(config);
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "keykeeperVersionRestored" }),
    );
    expect(routerCache.back).toHaveBeenCalled();
  });

  it("says first which passkey restoring would take away", async () => {
    current.login.fido2Credentials = [passkey("pk-1")];
    const el = await render();
    rows(el)[1].querySelector("button")!.click();
    await settle();
    buttons(el, "keykeeperRestoreVersion")[0].click();
    await settle();
    expect(dialogService.openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ key: "keykeeperRestoreVersionDropsPasskey" }),
        acceptButtonText: { key: "keykeeperRestoreAnyway" },
      }),
    );
  });

  it("doesn't restore when the server refuses it, as for an item edited since", async () => {
    formService.saveCipher.mockRejectedValue(
      new Error("The client copy of this cipher is out of date."),
    );
    const el = await render();
    rows(el)[1].querySelector("button")!.click();
    await settle();
    buttons(el, "keykeeperRestoreVersion")[0].click();
    await settle();
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "keykeeperRestoreFailed" }),
    );
    expect(routerCache.back).not.toHaveBeenCalled();
  });

  it("gives someone who can't see the item's passwords when and by whom only", async () => {
    current = login("third", {
      organizationId: "org-1",
      collectionIds: ["col-1"],
      viewPassword: false,
    });
    collections = [folder({ viewHistory: true })];
    hidePasswords = true;
    versions = [version("v2", null), version("v1", null)];
    const el = await render();

    expect(rows(el)).toHaveLength(2);
    expect(el.textContent).toContain("keykeeperVersionHistoryHiddenPasswords");
    expect(rows(el)[0].querySelector("button")).toBeNull();
    expect(cipherService.decrypt).not.toHaveBeenCalled();
    expect(buttons(el, "keykeeperClearHistory")).toHaveLength(0);
  });

  it("never decrypts versions for someone the item says can't see its passwords, whatever the server sends", async () => {
    current = login("third", {
      organizationId: "org-1",
      collectionIds: ["col-1"],
      viewPassword: false,
    });
    collections = [folder({ viewHistory: true, seePasswords: true })];
    const el = await render();
    expect(cipherService.decrypt).not.toHaveBeenCalled();
    expect(rows(el)[0].querySelector("button")).toBeNull();
  });

  it("offers Clear and Delete only with view item history and delete in the same shared folder", async () => {
    current = login("third", { organizationId: "org-1", collectionIds: ["col-1"] });
    collections = [folder({ viewHistory: true, seePasswords: true, edit: true })];
    let el = await render();
    expect(buttons(el, "keykeeperClearHistory")).toHaveLength(0);
    rows(el)[1].querySelector("button")!.click();
    await settle();
    expect(el.querySelector('[bitIconButton="bwi-trash"]')).toBeNull();
    TestBed.resetTestingModule();

    collections = [folder({ viewHistory: true, seePasswords: true, delete: true })];
    el = await render();
    buttons(el, "keykeeperClearHistory")[0].click();
    await settle();
    expect(apiService.send).toHaveBeenCalledWith(
      "DELETE",
      "/keykeeper/ciphers/item-1/history",
      null,
      true,
      false,
    );
  });

  it("offers no restore to someone who can see the item but not edit it", async () => {
    current = login("third", { organizationId: "org-1", collectionIds: ["col-1"], edit: false });
    collections = [folder({ viewHistory: true, seePasswords: true })];
    const el = await render();
    rows(el)[1].querySelector("button")!.click();
    await settle();
    expect(buttons(el, "keykeeperRestoreVersion")).toHaveLength(0);
  });

  it("shows nothing of the history to someone whose shared folders don't include it", async () => {
    current = login("third", { organizationId: "org-1", collectionIds: ["col-1"] });
    collections = [folder({ seePasswords: true })];
    const el = await render();
    expect(apiService.send).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="keykeeper-history-failed"]')).not.toBeNull();
  });
});
