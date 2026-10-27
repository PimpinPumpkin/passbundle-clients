import { SelectionModel } from "@angular/cdk/collections";
import { ElementRef, NO_ERRORS_SCHEMA, signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { ActivatedRoute, convertToParamMap, Params, provideRouter, Router } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { BehaviorSubject, EMPTY, of, Subject } from "rxjs";
import { map } from "rxjs/operators";

import {
  CollectionAdminService,
  CollectionService,
  OrganizationUserApiService,
} from "@bitwarden/admin-console/common";
import { SearchPipe } from "@bitwarden/angular/pipes/search.pipe";
import { VaultProfileService } from "@bitwarden/angular/vault/services/vault-profile.service";
import { AuthRequestServiceAbstraction, LockService, LogoutService } from "@bitwarden/auth/common";
import { AutomaticUserConfirmationService } from "@bitwarden/auto-confirm";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationApiServiceAbstraction } from "@bitwarden/common/admin-console/abstractions/organization/organization-api.service.abstraction";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { ProviderService } from "@bitwarden/common/admin-console/abstractions/provider.service";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { BillingApiServiceAbstraction } from "@bitwarden/common/billing/abstractions/billing-api.service.abstraction";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { VaultTimeoutSettingsService } from "@bitwarden/common/key-management/vault-timeout";
import { BroadcasterService } from "@bitwarden/common/platform/abstractions/broadcaster.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherArchiveService } from "@bitwarden/common/vault/abstractions/cipher-archive.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { SearchService } from "@bitwarden/common/vault/abstractions/search.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { TreeNode } from "@bitwarden/common/vault/models/domain/tree-node";
import { CipherResponse } from "@bitwarden/common/vault/models/response/cipher.response";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { CipherAuthorizationService } from "@bitwarden/common/vault/services/cipher-authorization.service";
import { RestrictedItemTypesService } from "@bitwarden/common/vault/services/restricted-item-types.service";
import { CipherViewLike } from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import {
  DialogRef,
  DialogService,
  DrawerRef,
  ScrollLayoutService,
  ToastService,
} from "@bitwarden/components";
import { MessageListener } from "@bitwarden/messaging";
import {
  ASSIGN_COLLECTIONS_DIALOG,
  AssignCollectionsDialogRef,
  AssignCollectionsResult,
  BULK_DELETE_DIALOG,
  BulkDeleteDialogRef,
  BulkDeleteDialogResult,
  CipherFormConfig,
  DefaultCipherFormConfigService,
  PasswordRepromptService,
  RoutedVaultFilterBridgeService,
  RoutedVaultFilterService,
  VaultBatchBarService,
  VaultFilter,
  VaultFilterServiceAbstraction,
  VaultItem,
  VaultItemDialogComponent,
  VaultItemDialogResult,
  VaultItemEvent,
  VaultItemsTransferService,
} from "@bitwarden/vault";

import { OrganizationWarningsService } from "../../billing/organizations/warnings/services";
import { KeykeeperMspApiService } from "../../keykeeper/msp/msp-api.service";
import { ProductSwitcherService } from "../../layouts/product-switcher/shared/product-switcher.service";
import { VaultItemsComponent } from "../components/vault-items/vault-items.component";
import { WebVaultExtensionPromptService } from "../services/web-vault-extension-prompt.service";
import { WebVaultPromptService } from "../services/web-vault-prompt.service";
import { WelcomeDialogService } from "../services/welcome-dialog.service";

import { VaultBannersService } from "./vault-banners/services/vault-banners.service";
import { VaultOnboardingService } from "./vault-onboarding/services/abstraction/vault-onboarding.service";
import { VaultComponent } from "./vault.component";

const TEST_CIPHER_ID = "test-cipher-id";
const TEST_USER_ID = "test-user-id" as UserId;

describe("VaultComponent", () => {
  let component: VaultComponent<any>;
  let fixture: ComponentFixture<VaultComponent<any>>;
  let queryParamsSubject: BehaviorSubject<Params>;

  let mockCipher: Cipher;
  let cipherAuthorizationServiceMock: MockProxy<CipherAuthorizationService>;
  let openVaultItemDialogSpy: jest.SpyInstance;
  // Keykeeper: an item opens to view in the side panel, a drawer.
  let openVaultItemPanelSpy: jest.SpyInstance;

  beforeEach(async () => {
    queryParamsSubject = new BehaviorSubject<Params>({});
    openVaultItemDialogSpy = jest.spyOn(VaultItemDialogComponent, "open").mockReturnValue({
      closed: new Subject<VaultItemDialogResult>(),
    } as unknown as DialogRef<VaultItemDialogResult, unknown>);

    openVaultItemDialogSpy.mockClear();
    openVaultItemPanelSpy = jest.spyOn(VaultItemDialogComponent, "openDrawer").mockResolvedValue({
      closed: new Subject<VaultItemDialogResult>(),
      isDrawer: true,
    } as unknown as DrawerRef<VaultItemDialogResult, unknown>);
    openVaultItemPanelSpy.mockClear();

    mockCipher = {
      id: TEST_CIPHER_ID,
      reprompt: 0,
      type: CipherType.Login,
      edit: true,
      viewPassword: true,
    } as Cipher;

    cipherAuthorizationServiceMock = mock<CipherAuthorizationService>();
    cipherAuthorizationServiceMock.canCloneCipher$.mockReturnValue(of(true));

    const cipherServiceMock = mock<CipherService>();
    cipherServiceMock.get.mockResolvedValue(mockCipher);
    cipherServiceMock.cipherListViews$.mockReturnValue(of([]));
    cipherServiceMock.failedToDecryptCiphers$.mockReturnValue(of([]));

    const organizationServiceMock = mock<OrganizationService>();
    organizationServiceMock.organizations$.mockReturnValue(of([]));

    const collectionServiceMock = mock<CollectionService>();
    collectionServiceMock.decryptedCollections$.mockReturnValue(of([]));

    const billingMock = mock<BillingAccountProfileStateService>();
    billingMock.hasPremiumFromAnySource$.mockReturnValue(of(false));

    const policyServiceMock = mock<PolicyService>();
    policyServiceMock.policyAppliesToUser$.mockReturnValue(of(false));
    policyServiceMock.policiesByType$.mockReturnValue(of([]));

    const mockActivatedRoute = {
      queryParams: queryParamsSubject.asObservable(),
      params: of({}),
      queryParamMap: queryParamsSubject.pipe(map((p) => convertToParamMap(p))),
      paramMap: of(convertToParamMap({})),
      data: of({}),
      get snapshot() {
        return { queryParams: queryParamsSubject.value };
      },
    };

    const emptyTreeNode = (name: string) => new TreeNode({ id: "", name } as any, null);

    await TestBed.configureTestingModule({
      imports: [VaultComponent],
      providers: [
        provideRouter([]),
        { provide: MessagingService, useValue: mock<MessagingService>() },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        { provide: BroadcasterService, useValue: mock<BroadcasterService>() },
        {
          provide: VaultFilterServiceAbstraction,
          useValue: {
            ...mock<VaultFilterServiceAbstraction>(),
            collectionTree$: of(emptyTreeNode("collections")),
            folderTree$: of(emptyTreeNode("folders")),
            organizationTree$: of(emptyTreeNode("organizations")),
            cipherTypeTree$: of(emptyTreeNode("cipherTypes")),
            filteredCollections$: of([]),
            // Keykeeper: the page uses this one now, not one of its own with
            // the filter panel's module, which is the left menu.
            clearOrganizationFilter: jest.fn(),
            setOrganizationFilter: jest.fn(),
          },
        },
        { provide: PasswordRepromptService, useValue: mock<PasswordRepromptService>() },
        { provide: FolderService, useValue: mock<FolderService>() },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: TotpService, useValue: mock<TotpService>() },
        { provide: EventCollectionService, useValue: mock<EventCollectionService>() },
        { provide: SearchService, useValue: mock<SearchService>() },
        { provide: SearchPipe, useValue: mock<SearchPipe>() },
        { provide: ApiService, useValue: mock<ApiService>() },
        // Keykeeper: the two-step login notice asks who's waiting.
        {
          provide: KeykeeperMspApiService,
          useValue: {
            twoStepNeeded: () => Promise.resolve([]),
            unacceptedRoles: () => Promise.resolve([]),
          },
        },
        { provide: ToastService, useValue: mock<ToastService>() },
        { provide: BillingApiServiceAbstraction, useValue: mock<BillingApiServiceAbstraction>() },
        { provide: OrganizationWarningsService, useValue: mock<OrganizationWarningsService>() },
        { provide: PremiumUpgradePromptService, useValue: mock<PremiumUpgradePromptService>() },
        { provide: SyncService, useValue: mock<SyncService>() },
        {
          provide: ConfigService,
          useValue: {
            ...mock<ConfigService>(),
            getFeatureFlag$: jest.fn().mockReturnValue(of(false)),
          },
        },
        { provide: DialogService, useValue: mock<DialogService>() },
        { provide: WelcomeDialogService, useValue: mock<WelcomeDialogService>() },
        { provide: OrganizationUserApiService, useValue: mock<OrganizationUserApiService>() },
        { provide: CollectionAdminService, useValue: mock<CollectionAdminService>() },
        { provide: CipherAuthorizationService, useValue: cipherAuthorizationServiceMock },
        { provide: ProviderService, useValue: mock<ProviderService>() },
        { provide: LogoutService, useValue: mock<LogoutService>() },
        { provide: LockService, useValue: mock<LockService>() },
        {
          provide: AvatarService,
          useValue: { ...mock<AvatarService>(), avatarColor$: of(null) },
        },
        {
          provide: StateProvider,
          useValue: {
            ...mock<StateProvider>(),
            getUser: jest.fn().mockReturnValue({ update: jest.fn(), state$: of({}) }),
          },
        },

        {
          provide: OrganizationApiServiceAbstraction,
          useValue: mock<OrganizationApiServiceAbstraction>(),
        },
        {
          provide: AuthRequestServiceAbstraction,
          useValue: mock<AuthRequestServiceAbstraction>(),
        },
        {
          provide: AutomaticUserConfirmationService,
          useValue: mock<AutomaticUserConfirmationService>(),
        },
        {
          provide: WebVaultExtensionPromptService,
          useValue: mock<WebVaultExtensionPromptService>(),
        },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: CipherService, useValue: cipherServiceMock },
        { provide: CollectionService, useValue: collectionServiceMock },
        { provide: BillingAccountProfileStateService, useValue: billingMock },
        { provide: OrganizationService, useValue: organizationServiceMock },
        { provide: PolicyService, useValue: policyServiceMock },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: MessageListener, useValue: { allMessages$: EMPTY } },
        {
          provide: VaultOnboardingService,
          useValue: { vaultOnboardingState$: jest.fn().mockReturnValue({ state$: of([]) }) },
        },
        {
          provide: AccountService,
          useValue: {
            activeAccount$: of({
              id: TEST_USER_ID,
              email: "test@test.com",
              emailVerified: true,
              name: "Test",
            }),
          },
        },
        { provide: RestrictedItemTypesService, useValue: { restricted$: of([]) } },
        {
          provide: CipherArchiveService,
          useValue: {
            userCanArchive$: jest.fn().mockReturnValue(of(false)),
            showSubscriptionEndedMessaging$: jest.fn().mockReturnValue(of(false)),
            archivedCiphers$: jest.fn().mockReturnValue(of([])),
            userHasPremium$: jest.fn().mockReturnValue(of([])),
          },
        },
        {
          provide: VaultTimeoutSettingsService,
          useValue: { availableVaultTimeoutActions$: () => of([]) },
        },
        {
          provide: ProductSwitcherService,
          useValue: {
            products$: of({ bento: [], other: [] }),
            organizations$: of([]),
            providers$: of([]),
          },
        },
        {
          provide: VaultProfileService,
          useValue: { getProfileCreationDate: jest.fn().mockResolvedValue(new Date()) },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(VaultComponent, {
        set: {
          providers: [
            {
              provide: RoutedVaultFilterService,
              useValue: { filter$: of({}) },
            },
            {
              provide: RoutedVaultFilterBridgeService,
              useValue: {
                activeFilter$: of(new VaultFilter()),
                navigate: jest.fn(),
              },
            },
            {
              provide: DefaultCipherFormConfigService,
              useValue: {
                buildConfig: jest.fn().mockImplementation((mode) =>
                  Promise.resolve({
                    mode,
                    cipherType: mockCipher.type,
                    admin: false,
                    organizationDataOwnershipDisabled: true,
                    originalCipher: mockCipher,
                    collections: [],
                    organizations: [],
                    folders: [],
                  }),
                ),
              },
            },
            {
              provide: WebVaultPromptService,
              useValue: { conditionallyPromptUser: jest.fn() },
            },
            {
              provide: VaultItemsTransferService,
              useValue: mock<VaultItemsTransferService>(),
            },
            {
              provide: VaultBatchBarService,
              useValue: {
                completed$: EMPTY,
                selection: new SelectionModel<VaultItem<any>>(true, [], true),
                setConfig: jest.fn(),
                bulkArchive: jest.fn(),
                bulkUnarchive: jest.fn(),
                bulkRestore: jest.fn(),
                bulkDelete: jest.fn(),
                bulkMoveToFolder: jest.fn(),
                bulkAssignToCollections: jest.fn(),
                enabled: signal(false),
                barVisible: signal(false),
              },
            },
            {
              provide: ASSIGN_COLLECTIONS_DIALOG,
              useValue: {
                open: jest.fn().mockResolvedValue(AssignCollectionsResult.Canceled),
              } satisfies AssignCollectionsDialogRef,
            },
            {
              provide: BULK_DELETE_DIALOG,
              useValue: {
                open: jest.fn().mockResolvedValue(BulkDeleteDialogResult.Canceled),
              } satisfies BulkDeleteDialogRef,
            },
          ],
        },
      })
      .overrideProvider(VaultBannersService, {
        useValue: mock<VaultBannersService>(),
      })
      .compileComponents();

    // Provide a scroll host so `bitScrollLayout` (used by nested table components) can resolve its
    // scrollable element and doesn't log a "can't find scroll host" error during tests.
    TestBed.inject(ScrollLayoutService).scrollableRef.set(
      new ElementRef(document.createElement("div")),
    );

    fixture = TestBed.createComponent(VaultComponent);
    component = fixture.componentInstance;
  });

  it("creates", () => {
    expect(component).toBeTruthy();
  });

  describe("Keykeeper: a copy by its address", () => {
    it("opens for someone with see passwords and share", async () => {
      await openByAddress();
      expect(copyFormOpened()).toBe(true);
    });

    async function openByAddress() {
      queryParamsSubject.next({ action: "clone", itemId: TEST_CIPHER_ID });
      fixture = TestBed.createComponent(VaultComponent);
      fixture.detectChanges();
      await fixture.whenStable();
    }

    /** Whether any form opened to copy the item (the address also opens it to edit, as upstream does). */
    const copyFormOpened = () =>
      openVaultItemDialogSpy.mock.calls.some(([, params]) => params?.formConfig?.mode === "clone");

    it("is refused without see passwords on the item", async () => {
      mockCipher.viewPassword = false;
      await openByAddress();
      expect(copyFormOpened()).toBe(false);
    });

    it("is refused for an item that doesn't say whether passwords show", async () => {
      delete mockCipher.viewPassword;
      await openByAddress();
      expect(copyFormOpened()).toBe(false);
    });

    it("is refused without share, as canCloneCipher$ decides", async () => {
      cipherAuthorizationServiceMock.canCloneCipher$.mockReturnValue(of(false));
      await openByAddress();
      expect(copyFormOpened()).toBe(false);
    });
  });

  [
    { action: "view", formDetails: { mode: "view", formMode: "edit" } },
    { action: "edit", eventName: "editCipher", formDetails: { mode: "form", formMode: "edit" } },
    { action: "clone", eventName: "clone", formDetails: { mode: "form", formMode: "clone" } },
  ].forEach(({ action, eventName, formDetails }) => {
    describe(`${action} cipher`, () => {
      it(`${action}s cipher when from action query param when initializing`, async () => {
        queryParamsSubject.next({ action, itemId: TEST_CIPHER_ID });
        // recreate component to trigger constructor logic
        fixture = TestBed.createComponent(VaultComponent);
        fixture.detectChanges();
        await fixture.whenStable();

        const spy = action === "view" ? openVaultItemPanelSpy : openVaultItemDialogSpy;
        expect(spy).toHaveBeenCalled();

        const params = spy.mock.lastCall[1];
        expect(params.mode).toBe(formDetails.mode);
        expect(params.formConfig.mode).toBe(formDetails.formMode);
      });

      it(`${action}s cipher when from action query param when query param changes`, async () => {
        queryParamsSubject.next({});
        // recreate component to trigger constructor logic
        fixture = TestBed.createComponent(VaultComponent);
        fixture.detectChanges();

        expect(openVaultItemDialogSpy).not.toHaveBeenCalled();

        queryParamsSubject.next({ action, cipherId: TEST_CIPHER_ID });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(
          action === "view" ? openVaultItemPanelSpy : openVaultItemDialogSpy,
        ).toHaveBeenCalled();
      });

      if (eventName) {
        it(`${action}s cipher from ${eventName} event`, async () => {
          const vaultItemsComponent = fixture.debugElement.query(By.directive(VaultItemsComponent))
            .componentInstance as VaultItemsComponent<CipherViewLike>;

          vaultItemsComponent.onEvent.emit({
            type: eventName,
            item: { id: TEST_CIPHER_ID },
          } as unknown as VaultItemEvent<CipherViewLike>);
          fixture.detectChanges();
          await fixture.whenStable();

          expect(openVaultItemDialogSpy).toHaveBeenCalled();
        });
      }

      describe("password reprompt", () => {
        let promptSpy: jest.SpyInstance;
        let navigateSpy: jest.SpyInstance;

        beforeEach(async () => {
          const passwordRepromptService = TestBed.inject(PasswordRepromptService);
          const router = TestBed.inject(Router);
          navigateSpy = jest.spyOn(router, "navigate").mockResolvedValue(true);
          promptSpy = jest
            .spyOn(passwordRepromptService, "showPasswordPrompt")
            .mockResolvedValue(true);

          mockCipher.reprompt = 1; // Require reprompt
          queryParamsSubject.next({ action, itemId: TEST_CIPHER_ID });
        });

        it("prompts the user for password reprompt if the cipher requires reprompt", async () => {
          fixture = TestBed.createComponent(VaultComponent);
          fixture.detectChanges();
          await fixture.whenStable();

          expect(promptSpy).toHaveBeenCalled();
        });

        it("resets the params when the user fails reprompt", async () => {
          promptSpy.mockResolvedValueOnce(false);

          fixture = TestBed.createComponent(VaultComponent);
          fixture.detectChanges();
          await fixture.whenStable();

          const params = navigateSpy.mock.calls[0][1];
          expect(params).toMatchObject({
            queryParams: {
              action: null,
              cipherId: null,
              itemId: null,
            },
          });
        });
      });
    });
  });

  describe("addCollection", () => {
    let dialogOpen: jest.Mock;

    const buildOrg = (id: string, overrides: Partial<Organization> = {}) =>
      ({
        id,
        name: id,
        canCreateNewCollections: true,
        isProviderUser: false,
        ...overrides,
      }) as Organization;

    beforeEach(() => {
      dialogOpen = jest.fn().mockReturnValue({
        closed: of(undefined),
      } as unknown as DialogRef<unknown, unknown>);
      (component as any).dialogService = { open: dialogOpen };
    });

    it("defaults the organization to the active filter's organization when one is selected", async () => {
      (component as any).allOrganizations = [buildOrg("org-1"), buildOrg("org-2")];
      component.activeFilter = { organizationId: "org-2" } as unknown as VaultFilter;

      await component.addCollection();

      expect(dialogOpen).toHaveBeenCalled();
      const config = dialogOpen.mock.lastCall[1];
      expect(config.data.organizationId).toBe("org-2");
    });

    it("falls back to the first eligible organization when the individual vault is selected", async () => {
      (component as any).allOrganizations = [buildOrg("org-1"), buildOrg("org-2")];
      component.activeFilter = { organizationId: "MyVault" } as unknown as VaultFilter;

      await component.addCollection();

      const config = dialogOpen.mock.lastCall[1];
      expect(config.data.organizationId).toBe("org-1");
    });

    it("falls back to the first eligible organization when no organization filter is selected", async () => {
      (component as any).allOrganizations = [buildOrg("org-1"), buildOrg("org-2")];
      component.activeFilter = { organizationId: null } as unknown as VaultFilter;

      await component.addCollection();

      const config = dialogOpen.mock.lastCall[1];
      expect(config.data.organizationId).toBe("org-1");
    });

    it("falls back to the first eligible organization when the filtered organization cannot create collections", async () => {
      (component as any).allOrganizations = [
        buildOrg("org-1"),
        buildOrg("org-2", { canCreateNewCollections: false }),
      ];
      component.activeFilter = { organizationId: "org-2" } as unknown as VaultFilter;

      await component.addCollection();

      const config = dialogOpen.mock.lastCall[1];
      expect(config.data.organizationId).toBe("org-1");
    });
  });

  // Keykeeper: a favorite isn't an edit of the item (DESIGN.md, "Item history").
  describe("toggling a favorite", () => {
    it("saves only the favorite, through the partial update, and keeps it locally", async () => {
      const view = new CipherView();
      view.id = TEST_CIPHER_ID;
      view.folderId = "folder-1";
      view.collectionIds = ["collection-1"];
      view.favorite = false;
      const cipherService = TestBed.inject(CipherService) as jest.Mocked<CipherService>;
      cipherService.getFullCipherView.mockResolvedValue(view);
      const apiService = TestBed.inject(ApiService) as jest.Mocked<ApiService>;
      apiService.putPartialCipher.mockResolvedValue(
        new CipherResponse({ id: TEST_CIPHER_ID, type: CipherType.Login, favorite: true }),
      );

      await component.handleFavoriteEvent(view);

      expect(apiService.putPartialCipher).toHaveBeenCalledWith(TEST_CIPHER_ID, {
        folderId: "folder-1",
        favorite: true,
      });
      expect(cipherService.updateWithServer).not.toHaveBeenCalled();
      const [saved, userId] = cipherService.upsert.mock.calls[0];
      expect(userId).toBe(TEST_USER_ID);
      expect(saved).toMatchObject({
        id: TEST_CIPHER_ID,
        favorite: true,
        collectionIds: ["collection-1"],
      });
    });
  });

  describe("addCipher", () => {
    const buildOrg = (id: string, overrides: Partial<Organization> = {}) =>
      ({
        id,
        name: id,
        enabled: true,
        ...overrides,
      }) as Organization;

    it("opens the vault item dialog when the target organization is enabled", async () => {
      (component as any).allOrganizations = [buildOrg("org-1", { enabled: true })];
      component.activeFilter = { organizationId: "org-1" } as unknown as VaultFilter;

      // The dialog's `closed` observable never emits in this test setup, so avoid
      // awaiting the full `addCipher()` call (which awaits dialog closure) and instead
      // flush pending microtasks until the dialog has been opened.
      void component.addCipher();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(openVaultItemDialogSpy).toHaveBeenCalled();
    });

    it("opens the vault item dialog when no organization is selected (individual vault)", async () => {
      (component as any).allOrganizations = [];
      component.activeFilter = { organizationId: "MyVault" } as unknown as VaultFilter;

      void component.addCipher();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(openVaultItemDialogSpy).toHaveBeenCalled();
    });

    it("does NOT open the vault item dialog when the target organization is suspended (disabled)", async () => {
      (component as any).allOrganizations = [buildOrg("org-1", { enabled: false })];
      component.activeFilter = { organizationId: "org-1" } as unknown as VaultFilter;

      await component.addCipher();

      expect(openVaultItemDialogSpy).not.toHaveBeenCalled();
    });
  });

  // Keykeeper: an item opens to view in the side panel beside the list, and
  // picking another row shows that one there (DESIGN.md, "The look").
  describe("the item's side panel", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const view = (id: string) =>
      ({ mode: "edit", originalCipher: { id } }) as unknown as CipherFormConfig;

    it("opens an item to view in the panel, which closes when another page opens", async () => {
      void component.openVaultItemDialog("view", view("a"));
      await flush();

      expect(openVaultItemPanelSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: "view" }),
        { closeOnNavigation: true },
      );
      expect(openVaultItemDialogSpy).not.toHaveBeenCalled();
    });

    it("lets the address open another item while the panel shows one, but not the panel's own, and nothing under a dialog", () => {
      const c = component as any;
      c.panelRef = { isDrawer: true };
      c.panelItemId = "a";

      expect(c.canOpenFromAddress({ itemId: "b", action: "view" })).toBe(true);
      expect(c.canOpenFromAddress({ cipherId: "b" })).toBe(true);
      // The panel's own changes to the address (to edit and back) open nothing,
      // and another item can always ask to take its place: the panel itself
      // asks before it throws away unsaved edits.
      expect(c.canOpenFromAddress({ itemId: "a", action: "edit" })).toBe(false);
      expect(c.canOpenFromAddress({ itemId: "b", action: "view" })).toBe(true);
      expect(c.canOpenFromAddress({ itemId: "a", action: "view" })).toBe(false);

      // A dialog is modal, as upstream has it, panel or not.
      c.vaultItemDialogRef = { isDrawer: false };
      expect(c.canOpenFromAddress({ itemId: "b" })).toBe(false);
      c.vaultItemDialogRef = undefined;
      c.panelRef = undefined;
      expect(c.canOpenFromAddress({ itemId: "b" })).toBe(true);
    });

    it("doesn't open an item twice while it's on its way into the panel", () => {
      const c = component as any;
      c.panelOpeningId = "a";
      expect(c.canOpenFromAddress({ itemId: "a", action: "view" })).toBe(false);
      expect(c.canOpenFromAddress({ itemId: "b", action: "view" })).toBe(true);
    });

    it("forgets an item that never made it into the panel", async () => {
      (TestBed.inject(CipherService).get as jest.Mock).mockResolvedValueOnce(null);
      jest.spyOn(component as any, "handleUnknownCipher").mockResolvedValue(undefined);

      await component.viewCipherById("gone");

      expect((component as any).panelOpeningId).toBeUndefined();
      expect(openVaultItemPanelSpy).not.toHaveBeenCalled();
    });

    it("clears the address when the panel closes, but not when another item took its place or the page is gone", async () => {
      const go = jest.spyOn(component as any, "go").mockResolvedValue(undefined);
      const openPanel = () => {
        const closed = new Subject<VaultItemDialogResult>();
        openVaultItemPanelSpy.mockResolvedValueOnce({ closed, isDrawer: true });
        return closed;
      };

      // Closed by hand: the address loses the item.
      queryParamsSubject.next({ itemId: "a", action: "view" });
      let closed = openPanel();
      let done = component.openVaultItemDialog("view", view("a"));
      await flush();
      closed.next(undefined);
      closed.complete();
      await done;
      expect(go).toHaveBeenCalledWith(
        { cipherId: null, itemId: null, action: null },
        expect.anything(),
      );

      // Replaced by another row's item, which the address names now.
      go.mockClear();
      closed = openPanel();
      done = component.openVaultItemDialog("view", view("a"));
      await flush();
      queryParamsSubject.next({ itemId: "b", action: "view" });
      closed.next(undefined);
      closed.complete();
      await done;
      expect(go).not.toHaveBeenCalled();

      // Closed because another page opened.
      queryParamsSubject.next({ itemId: "a", action: "view" });
      closed = openPanel();
      done = component.openVaultItemDialog("view", view("a"));
      await flush();
      component.ngOnDestroy();
      closed.next(undefined);
      closed.complete();
      await done;
      expect(go).not.toHaveBeenCalled();
    });

    it("puts the panel's item back in the address when it kept its unsaved edits instead of giving way", async () => {
      const go = jest.spyOn(component as any, "go").mockResolvedValue(undefined);
      const c = component as any;
      c.panelRef = { isDrawer: true, componentInstance: { keykeeperEditing: true } };
      c.panelItemId = "a";
      // The person went back to editing: the drawer didn't open.
      openVaultItemPanelSpy.mockResolvedValueOnce(undefined);

      await component.openVaultItemDialog("view", view("b"));

      expect(go).toHaveBeenCalledWith({ cipherId: null, itemId: "a", action: "edit" });
      expect(c.panelRef).toBeDefined();
    });

    it("closes the panel before a new item, or one opened to edit, opens in a dialog", async () => {
      const close = jest.fn().mockResolvedValue({ closed: true });
      (component as any).panelRef = {
        isDrawer: true,
        close,
        componentInstance: { keykeeperHasUnsavedEdits: false },
      };

      void component.openVaultItemDialog("form", view("b"));
      await flush();

      expect(close).toHaveBeenCalled();
      expect(openVaultItemDialogSpy).toHaveBeenCalled();
      expect(openVaultItemPanelSpy).not.toHaveBeenCalled();
    });

    it("keeps a panel with unsaved edits open under a dialog, and names its item again once the dialog closes", async () => {
      const go = jest.spyOn(component as any, "go").mockResolvedValue(undefined);
      const close = jest.fn().mockResolvedValue({ closed: true });
      const c = component as any;
      c.panelRef = {
        isDrawer: true,
        close,
        componentInstance: { keykeeperHasUnsavedEdits: true, keykeeperEditing: true },
      };
      c.panelItemId = "a";
      const dialogClosed = new Subject<VaultItemDialogResult>();
      openVaultItemDialogSpy.mockReturnValueOnce({ closed: dialogClosed });

      const done = component.openVaultItemDialog("form", view("b"));
      await flush();
      expect(close).not.toHaveBeenCalled();
      expect(openVaultItemDialogSpy).toHaveBeenCalled();
      // The address opens nothing while the dialog is up.
      expect(c.canOpenFromAddress({ itemId: "c" })).toBe(false);

      dialogClosed.next(VaultItemDialogResult.Saved);
      dialogClosed.complete();
      await done;

      expect(c.panelRef).toBeDefined();
      expect(c.panelItemId).toBe("a");
      expect(go).toHaveBeenCalledWith({ cipherId: null, itemId: "a", action: "edit" });
    });

    it("lets the list load beside an item opened from a link, rather than once the panel closes", async () => {
      // The panel never closes in this test.
      openVaultItemPanelSpy.mockResolvedValue({ closed: new Subject(), isDrawer: true });
      const viewCipher = jest.spyOn(VaultComponent.prototype, "viewCipher");
      queryParamsSubject.next({ action: "view", itemId: TEST_CIPHER_ID });
      fixture = TestBed.createComponent(VaultComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();

      expect(viewCipher).toHaveBeenCalled();
      // Once: the address naming the item it's opening doesn't open it again.
      expect(openVaultItemPanelSpy).toHaveBeenCalledTimes(1);
      expect((component as any).panelItemId).toBe(TEST_CIPHER_ID);
      expect((component as any).performingInitialLoad).toBe(false);
      viewCipher.mockRestore();
    });
  });
});
