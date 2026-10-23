import { NgComponentOutlet, NgTemplateOutlet } from "@angular/common";
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
  ViewEncapsulation,
} from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from "@angular/router";
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  lastValueFrom,
  map,
  Observable,
  of,
  ReplaySubject,
  startWith,
  Subject,
  switchMap,
  takeUntil,
} from "rxjs";

import { PremiumBadgeComponent } from "@bitwarden/angular/billing/components/premium-badge";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { TreeNode } from "@bitwarden/common/vault/models/domain/tree-node";
import { SearchTextDebounceInterval } from "@bitwarden/common/vault/services/search.service";
import {
  IconButtonModule,
  IconModule,
  MenuModule,
  NavigationModule,
  PopoverModule,
  SearchModule,
  SideNavService,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";
import {
  AddEditFolderDialogComponent,
  AddEditFolderDialogResult,
  CipherTypeFilter,
  FolderFilter,
  OrganizationFilter,
  RoutedVaultFilterBridgeService,
  RoutedVaultFilterModel,
  RoutedVaultFilterService,
  VAULT_FILTER_BASE_ROUTE,
  VaultFilterList,
  VaultFilterSection,
  Vfo1TerminologyService,
} from "@bitwarden/vault";

import { openCollectionDialog } from "../../admin-console/organizations/shared/components/collection-dialog";
import { CoachmarkComponent, CoachmarkService } from "../../vault/components/coachmark";
import { OrganizationOptionsComponent } from "../../vault/individual-vault/vault-filter/components/organization-options.component";
import { VaultFilterComponent } from "../../vault/individual-vault/vault-filter/components/vault-filter.component";
import { OptionsInput } from "../../vault/individual-vault/vault-filter/shared/components/vault-filter-section.component";

import { KeykeeperPickedLabelService } from "./picked-label.service";
import { buildVaultMenu, folderPick, pickedLabel, VaultMenuActions } from "./vault-menu";

/** The vault's own page, whatever its filters. */
export function isVaultUrl(router: Router): boolean {
  const segments = router.parseUrl(router.url).root.children["primary"]?.segments ?? [];
  return segments.length === 1 && segments[0].path === "vault";
}

/**
 * Keykeeper: the vault's part of the web vault's one left menu, like
 * 1Password's: search, All items, Favorites, Health, the categories, the
 * folders (Personal with its own, each organization with its shared ones),
 * Archive, and Trash. The user
 * layout puts the tools after it. It replaces the vault page's filter panel,
 * and is that panel underneath: the same sections and the same actions, on
 * the same routed filter, so picking an entry shows what picking it there
 * did. It shows on every page of the user layout; off the vault's page,
 * picking an entry opens the vault with it. See DESIGN.md, "The left menu".
 */
// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-keykeeper-vault-menu",
  templateUrl: "vault-menu.component.html",
  // The rows are the side nav's own; these rules reach into them, by this selector.
  encapsulation: ViewEncapsulation.None,
  styles: `
    app-keykeeper-vault-menu {
      display: block;
    }
    app-keykeeper-vault-menu .keykeeper-menu-heading {
      display: flex;
      align-items: center;
      min-height: 2.25rem;
      padding: 0.75rem 1.25rem 0 3rem;
    }
    app-keykeeper-vault-menu .keykeeper-menu-heading h2 {
      flex: 1;
      margin: 0;
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: inherit;
      opacity: 0.72;
    }
    app-keykeeper-vault-menu .keykeeper-menu-count {
      min-width: 1.25rem;
      text-align: end;
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      /* 4.5:1 or more on the nav, and on the brighter pill of the entry showing. */
      opacity: 0.8;
      cursor: pointer;
    }
    /* A folder's edit button and an organization's options show on hover and
       focus, and always where there's no hover (touch screens). */
    app-keykeeper-vault-menu .keykeeper-menu-reveal {
      display: none;
    }
    app-keykeeper-vault-menu bit-nav-item:hover .keykeeper-menu-reveal,
    app-keykeeper-vault-menu bit-nav-item:focus-within .keykeeper-menu-reveal {
      display: inline-flex;
    }
    @media (hover: none) {
      app-keykeeper-vault-menu .keykeeper-menu-reveal {
        display: inline-flex;
      }
    }
    /* The vault a category or folder is showing inside of: outlined, where
       the entry showing is filled. */
    app-keykeeper-vault-menu bit-nav-item.keykeeper-menu-scope [data-testid="nav-item-container"] {
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.3);
    }
  `,
  imports: [
    CoachmarkComponent,
    FormsModule,
    I18nPipe,
    IconButtonModule,
    IconModule,
    MenuModule,
    NavigationModule,
    NgComponentOutlet,
    NgTemplateOutlet,
    PopoverModule,
    PremiumBadgeComponent,
    RouterModule,
    SearchModule,
  ],
  providers: [
    // Picking an entry anywhere opens the vault's page with it.
    { provide: VAULT_FILTER_BASE_ROUTE, useValue: "/vault" },
    RoutedVaultFilterService,
    RoutedVaultFilterBridgeService,
  ],
})
export class KeykeeperVaultMenuComponent extends VaultFilterComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly routedFilterService = inject(RoutedVaultFilterService);
  private readonly bridgeService = inject(RoutedVaultFilterBridgeService);
  protected readonly sideNavService = inject(SideNavService);
  protected readonly coachmarkService = inject(CoachmarkService);
  private readonly terminology = inject(Vfo1TerminologyService);

  protected readonly organizationOptions = OrganizationOptionsComponent;
  protected readonly reportsCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "monitorSecurity",
  );
  protected readonly collectionsCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "shareWithCollections",
  );

  /** Once the routed filter is in, so a pick made sooner waits for it, then navigates. */
  private readonly routedFilterIn$ = new ReplaySubject<void>(1);
  private readonly sections = signal<VaultFilterList | undefined>(undefined);
  private readonly organizationSection = signal<VaultFilterSection | undefined>(undefined);

  private readonly onVault = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => isVaultUrl(this.router)),
    ),
    { initialValue: false },
  );
  private readonly routed = toSignal(this.routedFilterService.filter$, {
    initialValue: {} as RoutedVaultFilterModel,
  });
  private readonly ciphers = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) =>
        combineLatest([
          this.cipherService.cipherListViews$(userId),
          this.restrictedItemTypesService.restricted$,
        ]),
      ),
      map(([ciphers, restricted]) =>
        // Null while the vault decrypts. Restricted items aren't in the list, so they aren't counted.
        ciphers == null
          ? undefined
          : ciphers.filter(
              (c) => !this.restrictedItemTypesService.isCipherRestricted(c, restricted),
            ),
      ),
    ),
  );
  private readonly typeTree = this.sectionTree((s) => s.typeFilter);
  private readonly archiveTree = this.sectionTree((s) => s.archiveFilter);
  private readonly trashTree = this.sectionTree((s) => s.trashFilter);
  private readonly organizationTree = toSignal(this.vaultFilterService.organizationTree$);
  private readonly collectionTree = toSignal(this.vaultFilterService.collectionTree$);
  private readonly folderTree = toSignal(this.vaultFilterService.folderTree$);

  private readonly actions: VaultMenuActions = {
    all: () => this.pick(() => this.activeFilter.resetFilter()),
    type: (node) => this.pick(() => this.applyTypeFilter(node)),
    organization: (node) => this.pick(() => this.applyOrganizationFilter(node)),
    collection: (node) => this.pick(() => this.applyCollectionFilter(node)),
    // A personal folder shows what its owner filed there, out of any
    // organization that was showing (vault-menu.ts, folderPick).
    folder: (node) => this.pick(() => this.bridgeService.navigate(folderPick(this.routed(), node))),
    archive: async (node) => {
      const blocked = this.sections()?.archiveFilter?.premiumOptions?.blockFilterAction;
      if (blocked) {
        await blocked();
        return;
      }
      await this.pick(() => this.applyTypeFilter(node));
    },
  };

  protected readonly menu = computed(() => {
    const sections = this.sections();
    return buildVaultMenu(
      {
        onVault: this.onVault(),
        routed: this.routed(),
        ciphers: this.ciphers(),
        allItemsLabel: this.i18nService.t("allItems"),
        typeTree: this.typeTree(),
        organizationTree: this.organizationTree(),
        collectionTree: this.collectionTree(),
        folderTree: this.folderTree(),
        archive: this.archiveTree()?.children[0],
        archivePremiumBadge: !!sections?.archiveFilter?.premiumOptions?.showBadgeForNonPremium,
        trash: this.trashTree()?.children[0],
      },
      this.actions,
    );
  });

  // The vault page's title is the name of what's picked here.
  private readonly pickedLabelService = inject(KeykeeperPickedLabelService);
  private readonly publishPicked = effect(() =>
    this.pickedLabelService.label.set(pickedLabel(this.menu())),
  );

  /** What the edit button calls a folder, the way the panel did. */
  protected get folderLabelKey(): string {
    return this.terminology.enabled() ? "myFolder" : "folder";
  }

  /** "New organization", unless a policy keeps the person in one. */
  protected readonly newOrganization = computed(() => this.organizationSection()?.add);

  /** Organizations the person can make shared folders in, for New folder. */
  protected readonly sharedFolderOwners = computed(() =>
    (this.organizationTree()?.children ?? [])
      .map((o) => o.node)
      .filter((o) => o.id !== "MyVault" && o.canCreateNewCollections && !o.isProviderUser),
  );

  // Search, kept in the address the way the vault page kept it, so the list
  // reads it as before. Typing elsewhere opens the vault with it.
  private readonly searchBox = viewChild("searchBox", { read: ElementRef });
  private readonly searchTyped$ = new Subject<string>();
  private readonly searchInAddress = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get("search") ?? "")),
    { initialValue: "" },
  );

  private readonly optionsInjectors = new Map<string, Injector>();

  override async ngOnInit(): Promise<void> {
    // The panel's own start picks All items on the filter it's given. That's
    // the plain one it has until the routed filter comes in, so it never
    // navigates away from a filter in the address.
    await super.ngOnInit();
    this.sections.set(this.filters);

    this.bridgeService.activeFilter$.pipe(takeUntil(this.destroy$)).subscribe((filter) => {
      this.activeFilter = filter;
      this.routedFilterIn$.next();
    });

    // The collection and folder trees follow the vault in the address (the
    // panel only set it on a click), so Back, links, and pages without a
    // filter all agree with the menu.
    this.bridgeService.activeFilter$
      .pipe(
        map((filter) => filter.selectedOrganizationNode?.node ?? null),
        distinctUntilChanged((a, b) => a?.id === b?.id),
        takeUntil(this.destroy$),
      )
      .subscribe((organization) => this.vaultFilterService.setOrganizationFilter(organization));

    this.route.queryParamMap
      .pipe(
        map((params) => params.get("search") ?? ""),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
      )
      .subscribe((search) => (this.searchText = search));

    this.searchTyped$
      .pipe(debounceTime(SearchTextDebounceInterval), takeUntil(this.destroy$))
      .subscribe((text) => void this.showSearch(text));
  }

  override ngOnDestroy() {
    this.pickedLabelService.label.set(undefined);
    super.ngOnDestroy();
  }

  /** The panel's placeholder for what's showing, and "Search all items" for everything. */
  protected get menuSearchPlaceholder(): string {
    const key = this.searchPlaceholder;
    return key === "searchVault" ? "keykeeperSearchAllItems" : key;
  }

  protected override async addOrganizationFilter(): Promise<VaultFilterSection> {
    const section = await super.addOrganizationFilter();
    this.organizationSection.set(section);
    return section;
  }

  protected onSearch(text: string) {
    this.searchText = text;
    this.searchTyped$.next(text);
  }

  private async showSearch(text: string) {
    const search = Utils.isNullOrEmpty(text) ? null : text;
    if (isVaultUrl(this.router)) {
      if ((search ?? "") === this.searchInAddress()) {
        return;
      }
      await this.router.navigate([], {
        queryParams: { search },
        queryParamsHandling: "merge",
        replaceUrl: true,
        state: { focusAfterNav: false },
      });
    } else if (search != null) {
      await this.router.navigate(["/vault"], {
        queryParams: { search },
        state: { focusAfterNav: false },
      });
    }
  }

  /** With the menu closed to icons, its search icon opens it at the search box. */
  protected openSearch() {
    this.sideNavService.open.set(true);
    afterNextRender(() => this.searchBox()?.nativeElement.querySelector("input")?.focus(), {
      injector: this.injector,
    });
  }

  /** Where the menu covers the page (a phone), a pick closes it so the list shows. */
  private async pick(apply: () => void | Promise<void>) {
    await firstValueFrom(this.routedFilterIn$);
    await apply();
    if (this.sideNavService.isOverlay()) {
      this.sideNavService.open.set(false);
    }
  }

  /** A folder in Personal. */
  protected addFolder() {
    AddEditFolderDialogComponent.open(this.dialogService);
  }

  /** A shared folder in an organization, with upstream's dialog for its name and people. */
  protected async addSharedFolder(organizationId: OrganizationId) {
    const dialog = openCollectionDialog(this.dialogService, {
      data: {
        organizationId,
        showOrgSelector: false,
        limitNestedCollections: true,
      },
    });
    await lastValueFrom(dialog.closed);
  }

  protected async editFolderEntry(folder: FolderFilter) {
    const dialogRef = AddEditFolderDialogComponent.open(this.dialogService, {
      editFolderConfig: {
        // A copy, with the full name of a folder inside another.
        folder: { ...folder, name: folder.fullName ?? folder.name },
      },
    });
    const result = await lastValueFrom(dialogRef.closed);
    if (result === AddEditFolderDialogResult.Deleted && this.routed().folderId === folder.id) {
      await this.router.navigate([], {
        queryParams: { folderId: null },
        queryParamsHandling: "merge",
        replaceUrl: true,
      });
    }
  }

  protected async newOrganizationClicked(route: string) {
    await this.router.navigate([route]);
  }

  /** The organization's options menu (leave, account recovery, SSO), as the panel had it. */
  protected optionsInjector(organization: OrganizationFilter): Injector {
    let injector = this.optionsInjectors.get(organization.id);
    if (injector == null) {
      const organization$ = this.vaultFilterService.organizationTree$.pipe(
        map((tree) => tree.children.find((c) => c.node.id === organization.id)?.node),
        filter((node): node is OrganizationFilter => node != null),
      );
      injector = Injector.create({
        providers: [{ provide: OptionsInput, useValue: organization$ }],
        parent: this.injector,
      });
      this.optionsInjectors.set(organization.id, injector);
    }
    return injector;
  }

  private sectionTree(section: (sections: VaultFilterList) => VaultFilterSection | undefined) {
    return toSignal(
      toObservable(this.sections).pipe(
        switchMap(
          (sections) =>
            ((sections && section(sections)?.data$) ?? of(undefined)) as Observable<
              TreeNode<CipherTypeFilter> | undefined
            >,
        ),
      ),
    );
  }
}
