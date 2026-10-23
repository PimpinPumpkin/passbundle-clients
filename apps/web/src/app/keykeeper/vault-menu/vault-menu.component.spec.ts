import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of, Subject } from "rxjs";

import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { BillingApiServiceAbstraction } from "@bitwarden/common/billing/abstractions/billing-api.service.abstraction";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherArchiveService } from "@bitwarden/common/vault/abstractions/cipher-archive.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { PremiumUpgradePromptService } from "@bitwarden/common/vault/abstractions/premium-upgrade-prompt.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { TreeNode } from "@bitwarden/common/vault/models/domain/tree-node";
import { RestrictedItemTypesService } from "@bitwarden/common/vault/services/restricted-item-types.service";
import { SearchTextDebounceInterval } from "@bitwarden/common/vault/services/search.service";
import { CipherViewLike } from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import { DialogService, SideNavService, ToastService } from "@bitwarden/components";
import {
  CipherTypeFilter,
  CollectionFilter,
  FolderFilter,
  OrganizationFilter,
  VaultFilterServiceAbstraction,
  Vfo1TerminologyService,
} from "@bitwarden/vault";
import { OrganizationWarningsService } from "@bitwarden/web-vault/app/billing/organizations/warnings/services";

import { CoachmarkService } from "../../vault/components/coachmark";

import { KeykeeperPickedLabelService } from "./picked-label.service";
import { KeykeeperVaultMenuComponent } from "./vault-menu.component";

@Component({ template: "", changeDetection: ChangeDetectionStrategy.OnPush })
class PageComponent {}

@Component({
  selector: "app-test-organization-options",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class OptionsStubComponent {}

const USER_ID = "user-1" as UserId;
const ORG = "org-1" as OrganizationId;

const typeFilters: CipherTypeFilter[] = [
  { id: "favorites", name: "Favorites", type: "favorites", icon: "bwi-star" },
  { id: "login", name: "Login", type: CipherType.Login, icon: "bwi-globe" },
  { id: "card", name: "Card", type: CipherType.Card, icon: "bwi-credit-card" },
  { id: "identity", name: "Identity", type: CipherType.Identity, icon: "bwi-id-card" },
  { id: "note", name: "Secure note", type: CipherType.SecureNote, icon: "bwi-sticky-note" },
];

function buildTypeTree(head: CipherTypeFilter, filters?: CipherTypeFilter[]) {
  const node = new TreeNode<CipherTypeFilter>(head, null!);
  node.children = (filters ?? []).map((f) => new TreeNode<CipherTypeFilter>(f, node, f.name));
  return of(node);
}

function organizationTree() {
  const head = new TreeNode<OrganizationFilter>({ id: "AllVaults" } as OrganizationFilter, null!);
  const myVault = Object.assign(new Organization(), {
    id: "MyVault",
    name: "My vault",
    icon: "bwi-user",
    enabled: true,
    hideOptions: true,
  });
  const contoso = Object.assign(new Organization(), {
    id: ORG,
    name: "Contoso",
    icon: "bwi-business",
    enabled: true,
  });
  head.children = [myVault, contoso].map(
    (o) => new TreeNode<OrganizationFilter>(o as OrganizationFilter, head),
  );
  return head;
}

function collectionTree() {
  const head = new TreeNode<CollectionFilter>({ id: "AllCollections" } as CollectionFilter, null!);
  head.children = [
    new TreeNode<CollectionFilter>(
      { id: "c-office", name: "Office", organizationId: ORG } as unknown as CollectionFilter,
      head,
    ),
  ];
  return head;
}

function folderTree() {
  const head = new TreeNode<FolderFilter>(
    { id: "AllFolders", name: "folders" } as FolderFilter,
    null!,
  );
  head.children = [
    new TreeNode<FolderFilter>({ id: "f-bank", name: "Banking" } as FolderFilter, head),
    new TreeNode<FolderFilter>({ id: "", name: "No folder" } as FolderFilter, head),
  ];
  return head;
}

function item(type: CipherType, more: Record<string, unknown> = {}): CipherViewLike {
  return { type, favorite: false, isDeleted: false, isArchived: false, ...more } as CipherViewLike;
}

describe("KeykeeperVaultMenuComponent", () => {
  let fixture: ComponentFixture<KeykeeperVaultMenuComponent>;
  let router: Router;
  let dialogService: ReturnType<typeof mock<DialogService>>;
  let vaultFilterService: ReturnType<typeof mock<VaultFilterServiceAbstraction>>;
  const sideNav = { open: signal(true), isOverlay: signal(false) };
  const ciphers$ = new BehaviorSubject<CipherViewLike[]>([]);

  beforeEach(async () => {
    sideNav.open.set(true);
    sideNav.isOverlay.set(false);
    ciphers$.next([
      item(CipherType.Login, { favorite: true, folderId: "f-bank" }),
      item(CipherType.Login, { organizationId: ORG, collectionIds: ["c-office"] }),
      item(CipherType.Card),
    ]);

    vaultFilterService = mock<VaultFilterServiceAbstraction>();
    vaultFilterService.buildTypeTree.mockImplementation(buildTypeTree);
    vaultFilterService.cipherTypeFilters$ = of(typeFilters);
    vaultFilterService.cipherTypeTree$ = of(
      new TreeNode<CipherTypeFilter>({ id: "AllItems", name: "allItems", type: "all" }, null!),
    );
    vaultFilterService.organizationTree$ = of(organizationTree());
    vaultFilterService.collectionTree$ = of(collectionTree());
    vaultFilterService.folderTree$ = of(folderTree());

    const policyService = mock<PolicyService>();
    policyService.policyAppliesToUser$.mockReturnValue(of(false));
    policyService.policiesByType$.mockReturnValue(of([]));

    const cipherService = mock<CipherService>();
    cipherService.cipherListViews$.mockReturnValue(ciphers$ as never);

    const cipherArchiveService = mock<CipherArchiveService>();
    cipherArchiveService.archivedCiphers$.mockReturnValue(of([]));
    cipherArchiveService.userHasPremium$.mockReturnValue(of(true));

    const billing = mock<BillingAccountProfileStateService>();
    billing.hasPremiumFromAnySource$.mockReturnValue(of(true));

    dialogService = mock<DialogService>();

    await TestBed.configureTestingModule({
      imports: [KeykeeperVaultMenuComponent],
      providers: [
        provideRouter([
          { path: "vault", component: PageComponent },
          { path: "sends", component: PageComponent },
          { path: "reports", component: PageComponent },
        ]),
        { provide: VaultFilterServiceAbstraction, useValue: vaultFilterService },
        { provide: PolicyService, useValue: policyService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
        { provide: BillingApiServiceAbstraction, useValue: mock<BillingApiServiceAbstraction>() },
        { provide: BillingAccountProfileStateService, useValue: billing },
        { provide: DialogService, useValue: dialogService },
        { provide: AccountService, useValue: mockAccountServiceWith(USER_ID) },
        {
          provide: RestrictedItemTypesService,
          useValue: { restricted$: of([]), isCipherRestricted: () => false },
        },
        { provide: CipherService, useValue: cipherService },
        { provide: CipherArchiveService, useValue: cipherArchiveService },
        { provide: PremiumUpgradePromptService, useValue: mock<PremiumUpgradePromptService>() },
        { provide: OrganizationWarningsService, useValue: mock<OrganizationWarningsService>() },
        { provide: Vfo1TerminologyService, useValue: { enabled: () => false } },
        { provide: SideNavService, useValue: sideNav },
        {
          provide: CoachmarkService,
          useValue: {
            activeStepId: signal(null),
            getStepPosition: () => undefined,
            getStepTitle: () => "",
            getStepDescription: () => "",
            getStepLearnMoreUrl: () => undefined,
            currentStepNumber: () => 1,
            totalSteps: () => 1,
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    await router.navigateByUrl("/vault");
    fixture = TestBed.createComponent(KeykeeperVaultMenuComponent);
    // The options menu's own services aren't the menu's concern here.
    (fixture.componentInstance as any).organizationOptions = OptionsStubComponent;
    await settle();
  });

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  /** Each row's name and what's right-aligned after it, top to bottom, with the headings. */
  function rows(): string[] {
    return Array.from(
      el().querySelectorAll<HTMLElement>(".keykeeper-menu-heading h2, bit-nav-item"),
    ).map((row) =>
      row.tagName === "H2"
        ? `# ${row.textContent!.trim()}`
        : [
            row.querySelector("[data-testid=nav-item-interactive]")?.textContent?.trim(),
            row.querySelector(".keykeeper-menu-count")?.textContent?.trim(),
          ]
            .filter(Boolean)
            .join(" "),
    );
  }

  function click(name: string) {
    const button = Array.from(
      el().querySelectorAll<HTMLElement>("[data-testid=nav-item-interactive]"),
    ).find((b) => b.textContent!.trim() === name);
    if (button == null) {
      throw new Error(`no entry "${name}" in ${rows().join(", ")}`);
    }
    button.click();
  }

  it("lists search, everything, Health, then categories, and the folders: Personal's, then each organization's", () => {
    expect(el().querySelector("bit-search")).not.toBeNull();
    expect(rows()).toEqual([
      "allItems 3",
      "Favorites 1",
      "keykeeperHealth",
      "# keykeeperCategories",
      "Login 2",
      "Card 1",
      "# keykeeperFolders",
      "My vault 2",
      "Banking 1",
      "No folder 1",
      "Contoso 1",
      "Office 1",
      "archiveNoun 0",
      "trash 0",
    ]);
  });

  /** The rows upstream's nav item shows as active. */
  function showing(): string[] {
    return Array.from(el().querySelectorAll<HTMLElement>("bit-nav-item"))
      .filter((row) => row.querySelector("[data-testid=nav-item-interactive] .tw-font-semibold"))
      .map((row) => row.querySelector("[data-testid=nav-item-interactive]")!.textContent!.trim());
  }

  it("shows All items as what's showing on the vault's page, and the vault as the scope", async () => {
    expect(showing()).toEqual(["allItems"]);

    click("Contoso");
    await settle();
    click("Login");
    await settle();

    expect(showing()).toEqual(["Login"]);
    expect(el().querySelector("bit-nav-item.keykeeper-menu-scope")?.textContent).toContain(
      "Contoso",
    );
  });

  it("gives the vault page what's showing, by name, for its title", async () => {
    const picked = TestBed.inject(KeykeeperPickedLabelService);
    expect(picked.label()).toBe("allItems");

    click("Contoso");
    await settle();
    expect(picked.label()).toBe("Contoso");

    click("Banking");
    await settle();
    expect(picked.label()).toBe("Banking");

    fixture.destroy();
    expect(picked.label()).toBeUndefined();
  });

  it("filters the vault through the routed filter, as the panel did", async () => {
    click("Card");
    await settle();
    expect(router.url).toBe("/vault?type=card");

    click("Contoso");
    await settle();
    expect(router.url).toBe(`/vault?type=card&organizationId=${ORG}`);
    expect(vaultFilterService.setOrganizationFilter).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: ORG }),
    );

    // A personal folder shows what's filed there, out of the organization.
    click("Banking");
    await settle();
    expect(router.url).toBe("/vault?folderId=f-bank");

    click("allItems");
    await settle();
    expect(router.url).toBe("/vault");
  });

  it("waits for the filter in the address before a pick made while the vault loads", async () => {
    // The routed filter needs the folders, which need the vault decrypted.
    const folders$ = new Subject<TreeNode<FolderFilter>>();
    vaultFilterService.folderTree$ = folders$;
    fixture.destroy();
    fixture = TestBed.createComponent(KeykeeperVaultMenuComponent);
    (fixture.componentInstance as any).organizationOptions = OptionsStubComponent;
    await settle();

    click("Card");
    await settle();
    expect(router.url).toBe("/vault");

    folders$.next(folderTree());
    await settle();
    expect(router.url).toBe("/vault?type=card");
  });

  it("opens the vault with an entry from another page", async () => {
    await router.navigateByUrl("/sends");
    await settle();
    expect(rows()).toContain("Login 2");

    click("Login");
    await settle();

    expect(router.url).toBe("/vault?type=login");
  });

  it("keeps the search in the address, on the vault's page or going to it", async () => {
    const input = el().querySelector<HTMLInputElement>("bit-search input")!;
    input.value = "bank";
    input.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, SearchTextDebounceInterval + 50));
    await settle();
    expect(router.url).toBe("/vault?search=bank");

    await router.navigateByUrl("/sends");
    await settle();
    expect(input.value).toBe("");
    input.value = "mail";
    input.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, SearchTextDebounceInterval + 50));
    await settle();
    expect(router.url).toBe("/vault?search=mail");
  });

  it("closes the menu after a pick where it covers the page", async () => {
    sideNav.isOverlay.set(true);

    click("Card");
    await settle();

    expect(sideNav.open()).toBe(false);
  });

  it("makes a folder from the button beside Folders, asking where it goes", async () => {
    const newFolder = el().querySelector<HTMLButtonElement>(
      ".keykeeper-menu-heading button[aria-label=newFolder]",
    );
    newFolder!.click();
    await settle();

    const where = Array.from(document.querySelectorAll<HTMLButtonElement>("[bitmenuitem]"));
    expect(where.map((b) => b.textContent!.trim())).toEqual([
      "myVault",
      "Contoso",
      "newOrganization",
    ]);
    where[0].click();
    expect(dialogService.open).toHaveBeenCalled();
  });

  it("keeps only icons for the rail when the menu is closed", async () => {
    sideNav.open.set(false);
    await settle();

    expect(el().querySelector("bit-search")).toBeNull();
    expect(el().querySelector(".keykeeper-menu-heading")).toBeNull();
    // Search, All items, Favorites, Health, two categories, Archive, Trash.
    expect(el().querySelectorAll("bit-nav-item [data-testid=nav-item-container]")).toHaveLength(8);
  });
});
