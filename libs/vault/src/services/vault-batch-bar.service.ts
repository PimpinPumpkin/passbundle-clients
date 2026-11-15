import { SelectionModel } from "@angular/cdk/collections";
import { computed, inject, Injectable, Signal, signal } from "@angular/core";
import { takeUntilDestroyed, toObservable, toSignal } from "@angular/core/rxjs-interop";
import {
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  lastValueFrom,
  map,
  of,
  startWith,
  Subject,
  switchMap,
} from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import {
  gridOf,
  itemGrid,
  itemLike,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { CollectionView, Unassigned } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { uuidAsString } from "@bitwarden/common/platform/abstractions/sdk/sdk.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CipherId, CollectionId, OrganizationId } from "@bitwarden/common/types/guid";
import { CipherArchiveService } from "@bitwarden/common/vault/abstractions/cipher-archive.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherRepromptType } from "@bitwarden/common/vault/enums/cipher-reprompt-type";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { CipherAuthorizationService } from "@bitwarden/common/vault/services/cipher-authorization.service";
import {
  CipherViewLike,
  CipherViewLikeUtils,
} from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import { DialogService, ToastService } from "@bitwarden/components";

import {
  BulkMoveDialogResult,
  openBulkMoveDialog,
} from "../components/bulk-action-dialogs/bulk-move-dialog/bulk-move-dialog.component";
import { compareVaultItems, VaultItem } from "../components/vault-item";
import { BulkPlan, runEach, splitByAllowed } from "../keykeeper/bulk-selection";
import { saveFavorite } from "../keykeeper/favorite";
import { All } from "../models/routed-vault-filter.model";
import {
  ASSIGN_COLLECTIONS_DIALOG,
  AssignCollectionsDialogRef,
  AssignCollectionsResult,
} from "../tokens/assign-collections-dialog.token";
import {
  BULK_DELETE_DIALOG,
  BulkDeleteDialogRef,
  BulkDeleteDialogResult,
} from "../tokens/bulk-delete-dialog.token";
import {
  BULK_EDIT_COLLECTION_ACCESS_DIALOG,
  BulkEditCollectionAccessDialogRef,
  BulkEditCollectionAccessResult,
} from "../tokens/bulk-edit-collection-access-dialog.token";

import { PasswordRepromptService } from "./password-reprompt.service";
import { RoutedVaultFilterBridgeService } from "./routed-vault-filter-bridge.service";
import { RoutedVaultFilterService } from "./routed-vault-filter.service";

/**
 * A read-only view of another component's selection, registered via {@link VaultBatchBarService.registerSelection}.
 * Deliberately narrow — the bar only reads and clears — so a host owns its selection outright.
 */
export interface VaultSelectionSource<C extends CipherViewLike> {
  /** The currently selected items. Read reactively, so the `can*` signals track it. */
  readonly selected: Signal<readonly VaultItem<C>[]>;
  /** Clears the selection at the source. Called after a completed bulk action. */
  clear(): void;
}

/** Context provided by the host vault component to drive permission checks and action availability. */
export interface VaultBatchBarConfig {
  /** When true when operating inside an org vault view. Enables admin API paths and org-specific permission checks. */
  isOrgVault: boolean;
  /** All collections visible in the current vault context, used for assign-to-collection eligibility. */
  allCollections: CollectionView[];
  /** When true, when the current vault filter has at least one cipher in the list. */
  hasCiphers: boolean;
  /** Should be populated when isOrgVault is true. Used to apply org-specific permission checks and admin API paths. */
  organization?: Organization;
  /** Whether the page is showing trashed items. */
  inTrash?: boolean;
  /**
   * The shared folder the page has drilled into; omit to read it off the route filter. A host that
   * scopes by route segment must set it, or Assign to collections can't preselect or remove it.
   */
  activeCollectionId?: CollectionId;
}

// Keykeeper: the wording for what an action leaves out, for one row and for
// several (brand/messages.en.json).
const SKIP_NOTICE = {
  delete: { one: "keykeeperBulkSkipDeleteOne", many: "keykeeperBulkSkipDelete" },
  restore: { one: "keykeeperBulkSkipRestoreOne", many: "keykeeperBulkSkipRestore" },
  move: { one: "keykeeperBulkSkipMoveOne", many: "keykeeperBulkSkipMove" },
  folders: { one: "keykeeperBulkSkipFoldersOne", many: "keykeeperBulkSkipFolders" },
} as const;

/**
 * Manages selection state and bulk actions for vault items (ciphers and collections).
 *
 * Provide this service at the "Vault" component level — it is **not** `providedIn: 'root'`.
 *
 * **Setup**
 *
 * 1. Provide the service in the "Vault" component's `providers` array.
 * 2. Call {@link setConfig} (e.g. in `ngOnChanges`) whenever the vault context changes so that
 *    permission signals stay up-to-date.
 * 3. Bind the `can*` signals to button visibility/disabled state in the host template.
 * 4. Subscribe to {@link completed$} to react to successful bulk operations (e.g. refresh the list).
 */
@Injectable()
export class VaultBatchBarService<C extends CipherViewLike> {
  private readonly cipherService = inject(CipherService);
  private readonly cipherArchiveService = inject(CipherArchiveService);
  private readonly cipherAuthorizationService = inject(CipherAuthorizationService);
  private readonly organizationService = inject(OrganizationService);
  private readonly passwordRepromptService = inject(PasswordRepromptService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly accountService = inject(AccountService);
  // Legacy vault only — VFO1 hosts drive scope through setConfig() and provide neither.
  // TODO: remove with the VFO1Foundation flag, along with every `?.` fallback they force.
  private readonly routedVaultFilterBridgeService = inject(RoutedVaultFilterBridgeService, {
    optional: true,
  });
  private readonly routedVaultFilterService = inject(RoutedVaultFilterService, { optional: true });
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  // Keykeeper: for marking several items as favorites, which goes one item at
  // a time through the same partial update the single item's star uses.
  private readonly apiService = inject(ApiService);
  // Keykeeper: for reading the vault again after the server refused partway.
  private readonly syncService = inject(SyncService);
  private readonly assignCollectionsDialog =
    inject<AssignCollectionsDialogRef>(ASSIGN_COLLECTIONS_DIALOG);
  private readonly bulkDeleteDialog = inject<BulkDeleteDialogRef>(BULK_DELETE_DIALOG);
  private readonly bulkEditCollectionAccessDialog = inject<BulkEditCollectionAccessDialogRef>(
    BULK_EDIT_COLLECTION_ACCESS_DIALOG,
    { optional: true },
  );

  private readonly defaultConfig: VaultBatchBarConfig = {
    isOrgVault: false,
    allCollections: [],
    hasCiphers: false,
  };

  private readonly config = signal<VaultBatchBarConfig>(this.defaultConfig);

  /** The route filter's own view of the trash, for hosts that express it as `?type=trash`. */
  private readonly filterInTrash = toSignal(
    this.routedVaultFilterService?.filter$.pipe(map((f) => f.type === "trash")) ?? of(false),
    { initialValue: false },
  );

  /**
   * Whether the page is showing trashed items — the host's {@link VaultBatchBarConfig.inTrash}
   * when it sets one, otherwise the route filter's `?type=trash`.
   */
  readonly inTrash = computed(() => this.config().inTrash ?? this.filterInTrash());

  private readonly showBulkAddToFolder = computed(
    () => !this.inTrash() && !this.config().isOrgVault,
  );

  private readonly allOrganizations = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => this.organizationService.organizations$(userId)),
    ),
    { initialValue: [] as Organization[] },
  );

  private readonly userCanArchive = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => this.cipherArchiveService.userCanArchive$(userId)),
    ),
    { initialValue: false },
  );

  /**
   * The Angular CDK selection model, and the default selection source. A host whose list has its own
   * selection state should call {@link registerSelection} instead, so the two can't disagree.
   *
   * TODO: remove with the VFO1Foundation flag, along with {@link selectionChanged} and
   * {@link defaultSelection} — VFO1 hosts all register their own source.
   */
  readonly selection = new SelectionModel<VaultItem<C>>(true, [], true, compareVaultItems);

  private readonly _completed$ = new Subject<void>();
  /** Emits once after each successful bulk action. Subscribe to trigger a list refresh. */
  readonly completed$ = this._completed$.asObservable();

  private readonly selectionChanged = toSignal(this.selection.changed.pipe(startWith(null)));

  /** The CDK model projected as a signal, used whenever no external source is registered. */
  private readonly defaultSelection = computed<readonly VaultItem<C>[]>(() => {
    this.selectionChanged();
    return this.selection.selected;
  });

  /**
   * The active selection source; `undefined` means {@link defaultSelection}. Holding the source
   * rather than a copy is the point — the bar can't report a selection the host's UI doesn't show.
   *
   * TODO: once VFO1 ships, every host registers a source — drop the `undefined` case and make this
   * required, which collapses {@link selected} and {@link clearSelection} to single expressions.
   */
  private readonly source = signal<VaultSelectionSource<C> | undefined>(undefined);

  /**
   * Registers an external selection source as the single source of truth for every `can*` signal and
   * bulk action. Call the returned teardown on destroy, or its selection outlives the component.
   */
  registerSelection(source: VaultSelectionSource<C>): () => void {
    this.source.set(source);
    return () => {
      // Only retract if this source is still the active one — a later registration owns it now.
      if (this.source() === source) {
        this.source.set(undefined);
      }
    };
  }

  /** Signal of all currently selected vault items. */
  readonly selected = computed<readonly VaultItem<C>[]>(
    () => this.source()?.selected() ?? this.defaultSelection(),
  );

  readonly selectedCount = computed(() => this.selected().length);

  /**
   * Clears the selection at its source — the registered one, else the CDK model. Every clear path must
   * funnel through this: with a source registered, {@link selected} never consults the CDK model.
   */
  clearSelection(): void {
    const source = this.source();
    if (source) {
      source.clear();
      return;
    }
    this.selection.clear();
  }

  readonly barVisible = computed(() => this.selectedCount() > 0);

  /** Selected items that are ciphers, excluding gated ("partial") rows, which are read-only. */
  readonly selectedCiphers = computed(() =>
    this.selected()
      .filter((i) => i.cipher !== undefined && !CipherViewLikeUtils.isPartial(i.cipher))
      .map((i) => i.cipher as C),
  );

  /** Selected items that are collections. */
  readonly selectedCollections = computed(() =>
    this.selected()
      .filter((i) => i.collection !== undefined)
      .map((i) => i.collection as CollectionView),
  );

  /** True when bulk add-to-folder is allowed. */
  readonly canAddToFolder = computed(() => {
    const selected = this.selected();
    return (
      this.showBulkAddToFolder() &&
      selected.length !== 0 &&
      selected.filter((item) => item.collection).length === 0
    );
  });

  /** True when all selected ciphers can be archived. */
  readonly canArchive = computed(() => {
    const selected = this.selected();
    const hasCollections = selected.some((i) => i.collection);
    if (
      selected.length === 0 ||
      !this.userCanArchive() ||
      hasCollections ||
      this.inTrash() ||
      this.config().isOrgVault
    ) {
      return false;
    }
    return !selected.find((item) => item.cipher && item.cipher.archivedDate);
  });

  /** True when all selected ciphers can be unarchived. */
  readonly canUnarchive = computed(() => {
    const selected = this.selected();
    if (selected.length === 0 || this.inTrash() || this.config().isOrgVault) {
      return false;
    }
    return !selected.find((i) => !i.cipher?.archivedDate);
  });

  /**
   * True when at least one selected cipher can be restored from trash.
   *
   * Keykeeper: upstream asked for all of them, so one view-only item in the
   * selection took Restore away with no word why. The ones that can't be
   * restored are counted and left out when it runs (DESIGN.md, "Selecting
   * several items"). Each item is still asked the single item's own rule.
   */
  readonly canRestore = toSignal(
    combineLatest([
      toObservable(this.selected),
      toObservable(this.config),
      toObservable(this.inTrash),
    ]).pipe(
      switchMap(([selected, config, inTrash]) => {
        const ciphers = selected.filter((i) => i.cipher).map((i) => i.cipher as C);

        if (selected.length === 0) {
          return of(true);
        }

        if (ciphers.length === 0) {
          return of(false);
        }

        const canRestoreCiphers$ = ciphers.map((c) =>
          this.cipherAuthorizationService.canRestoreCipher$(c, config.isOrgVault),
        );

        return combineLatest(canRestoreCiphers$).pipe(
          map((results) => results.some((r) => r) && inTrash),
        );
      }),
    ),
    { initialValue: true },
  );

  /**
   * True when at least one selected cipher or collection can be deleted by the current user.
   *
   * Keykeeper: at least one rather than all, as for {@link canRestore}.
   */
  readonly canDelete = toSignal(
    combineLatest([
      toObservable(this.selected),
      toObservable(this.config),
      toObservable(this.allOrganizations),
    ]).pipe(
      switchMap(([selected, config, allOrganizations]) => {
        if (selected.length === 0) {
          return of(true);
        }

        const ciphers = selected.filter((i) => i.cipher).map((i) => i.cipher as C);
        const collections = selected
          .filter((i) => i.collection)
          .map((i) => i.collection as CollectionView);

        const canDeleteCollections = collections.some((c) =>
          this.mayDeleteCollection(c, allOrganizations),
        );

        if (ciphers.length === 0) {
          return of(canDeleteCollections);
        }

        const canDeleteCiphers$ = ciphers.map((c) =>
          this.cipherAuthorizationService.canDeleteCipher$(c, config.isOrgVault),
        );

        return combineLatest(canDeleteCiphers$).pipe(
          map((results) => results.some((r) => r) || canDeleteCollections),
        );
      }),
    ),
    { initialValue: true },
  );

  /**
   * True when the selected ciphers can be assigned to collections.
   */
  readonly canAssignToCollections = computed(() => {
    const config = this.config();
    const allOrganizations = this.allOrganizations();
    const selected = this.selected();
    const selectedCiphers = selected.filter((i) => i.cipher).map((i) => i.cipher as C);
    const anyArchived = selectedCiphers.some((c) => CipherViewLikeUtils.isArchived(c));

    // Archived ciphers cannot be reassigned; block the action entirely if any are present.
    const bulkAssignAllowed = config.hasCiphers && !anyArchived;

    if (!bulkAssignAllowed) {
      return false;
    }

    // `isOrgVault` should only be true when the user is within the Admin Console.
    // Keykeeper: upstream answered yes for any selection here, because only rows
    // that passed the row's own check (edit and see passwords, or an admin who
    // reaches every item) had a checkbox. Every row has one now, so each item
    // is asked (mayAssign), and the action is offered when at least one passes.
    // Never in Trash: a single item's menu doesn't offer it there either, and
    // upstream's bar did.
    if (config.isOrgVault && selectedCiphers.length !== 0) {
      return (
        !this.inTrash() && selectedCiphers.some((c) => this.mayAssign(c, config, allOrganizations))
      );
    }

    // Baseline checks:
    // - Cannot assign ciphers when viewing the trash
    // - An org membership is required
    // - At least one cipher must be selected
    if (this.inTrash() || allOrganizations.length === 0 || selected.length === 0) {
      return false;
    }

    const hasPersonalItems = selectedCiphers.some((c) => !c.organizationId);
    const uniqueOrgIds = new Set(
      selectedCiphers.flatMap((c) => c.organizationId ?? null).filter(Boolean),
    );
    // Keykeeper: a shared folder they can add items to (create).
    const hasEditableCollections = config.allCollections.some((c) => gridOf(c).create);

    // Personal (non-org) ciphers: allow if there is at least one editable collection to target.
    if (uniqueOrgIds.size === 0 && hasEditableCollections) {
      return hasPersonalItems;
    }

    const collectionNotSelected = selected.filter((i) => i.collection).length === 0;
    // Keykeeper: offered when at least one selected item passes the rule
    // upstream asked of all of them (mayAssign); the rest are counted and left
    // out when it runs. Items of more than one organization can't go in one
    // go, and upstream hid the action for them. It stays, and says why
    // (bulkAssignToCollections).
    const someCiphersHaveEdit = selectedCiphers.some((c) =>
      this.mayAssign(c, config, allOrganizations),
    );

    return someCiphersHaveEdit && collectionNotSelected && hasEditableCollections;
  });

  /**
   * Keykeeper: true when the selection can be marked as favorites, or taken
   * out of them: in someone's own vault, outside the trash, with only items
   * selected. A favorite is the person's own mark on an item, so it needs no
   * permission on the item, as with the star in a single item's menu.
   */
  readonly canFavorite = computed(() => {
    const selected = this.selected();
    const ciphers = this.selectedCiphers();
    if (
      this.config().isOrgVault ||
      this.inTrash() ||
      ciphers.length === 0 ||
      ciphers.length !== selected.length
    ) {
      return false;
    }
    // The single item's menu has no star for an archived item when the person
    // can't archive.
    return this.userCanArchive() || !ciphers.some((c) => CipherViewLikeUtils.isArchived(c));
  });

  /**
   * Keykeeper: what the favorite action does to this selection. It marks the
   * ones that aren't favorites yet; once every one of them is, it takes them
   * all out of the favorites.
   */
  readonly favoriteAdds = computed(() => this.selectedCiphers().some((c) => !c.favorite));

  private readonly _progress = signal<{ done: number; total: number } | null>(null);
  /**
   * Keykeeper: how far an action that goes one item at a time has got, or
   * null when none is running. The bar shows it and holds its buttons.
   */
  readonly progress = this._progress.asReadonly();

  /**
   * True when the selected items are collections-only and the vault context is an org vault.
   * Per-collection `canEdit(org)` checks are deferred to {@link bulkEditCollectionAccess}.
   */
  readonly canEditCollectionAccess = computed(() => {
    const config = this.config();
    const selected = this.selected();
    if (!config.isOrgVault || selected.length === 0) {
      return false;
    }
    return selected.some((i) => i.collection !== undefined);
  });

  constructor() {
    // Without the route filter, the host owns scope changes and clears the selection itself.
    this.routedVaultFilterService?.filter$
      .pipe(
        distinctUntilChanged(
          (prev, curr) =>
            prev.organizationId === curr.organizationId &&
            prev.collectionId === curr.collectionId &&
            prev.folderId === curr.folderId &&
            prev.type === curr.type &&
            prev.organizationIdParamType === curr.organizationIdParamType,
        ),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.clearSelection();
      });
  }

  /** Update the vault context. Call in `ngOnChanges` or when configuration values change so permission signals stay current. */
  setConfig(config: VaultBatchBarConfig): void {
    this.config.set(config);
  }

  /** Archive the selected ciphers after confirmation. No-op if reprompt is cancelled. */
  async bulkArchive(): Promise<void> {
    const ciphers = this.selectedCiphers();

    if (!(await this.reprompt(ciphers))) {
      return;
    }

    const titleKey = ciphers.length === 1 ? "archiveItemTitle" : "archiveItemsPlural";
    const contentKey =
      ciphers.length === 1 ? "archiveItemDialogContent" : "archiveItemsPluralDescription";
    const successKey = ciphers.length === 1 ? "itemArchiveToast" : "bulkArchiveItems";

    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: titleKey, placeholders: [ciphers.length] },
      content: { key: contentKey },
      acceptButtonText: { key: "archiveVerb" },
      type: "info",
    });

    if (!confirmed) {
      return;
    }

    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const cipherIds = ciphers.map((c) => c.id as unknown as CipherId);
    try {
      await this.cipherArchiveService.archiveWithServer(cipherIds, userId);
      this.toastService.showToast({
        variant: "success",
        message: this.i18nService.t(successKey),
      });
      this.clearSelection();
      this._completed$.next();
    } catch (e) {
      this.logService.error("Error archiving ciphers", e);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("errorOccurred"),
      });
    }
  }

  /** Unarchive the selected ciphers. No-op if reprompt is cancelled. */
  async bulkUnarchive(): Promise<void> {
    const ciphers = this.selectedCiphers();

    if (!(await this.reprompt(ciphers))) {
      return;
    }

    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const cipherIds = ciphers.map((c) => c.id as unknown as CipherId);
    try {
      await this.cipherArchiveService.unarchiveWithServer(cipherIds, userId);
      this.toastService.showToast({
        variant: "success",
        message: this.i18nService.t(
          ciphers.length === 1 ? "itemUnarchivedToast" : "bulkUnarchiveItems",
        ),
      });
      this.clearSelection();
      this._completed$.next();
    } catch (e) {
      this.logService.error("Error unarchiving ciphers", e);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("errorOccurred"),
      });
    }
  }

  /**
   * Restore the selected ciphers from trash. Handles both org and personal vault paths.
   *
   * Keykeeper: the ones the person may not restore are left out, not the whole
   * action refused. It says how many before it starts and again when it is
   * done (DESIGN.md, "Selecting several items").
   */
  async bulkRestore(): Promise<void> {
    const ciphers = this.selectedCiphers();
    const { isOrgVault, organization: org } = this.config();

    if (ciphers.length === 0) {
      this.toastService.showToast({
        variant: "error",
        ...(org != null ? { title: this.i18nService.t("errorOccurred") } : {}),
        message: this.i18nService.t("nothingSelected"),
      });
      return;
    }

    const canRestore = await firstValueFrom(
      combineLatest(
        ciphers.map((c) => this.cipherAuthorizationService.canRestoreCipher$(c, isOrgVault)),
      ),
    );
    // In an organization's vault, upstream went on to drop, without a word,
    // the items that are in a shared folder but that the person can't edit.
    // They count as skipped here, by that same test.
    const plan = splitByAllowed(
      ciphers,
      ciphers.map(
        (c, i) =>
          canRestore[i] &&
          (org == null || org.canEditAllCiphers || CipherViewLikeUtils.isUnassigned(c) || c.edit),
      ),
    );

    if (plan.allowed.length === 0) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("missingPermissions"),
      });
      return;
    }

    const notice = this.skipNotice("restore", plan);
    if (notice != null) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: { key: "restoreSelected" },
        content: notice,
        acceptButtonText: { key: "restore" },
        type: "info",
      });
      if (!confirmed) {
        return;
      }
    }

    const toastMessage = plan.allowed.some((c) => !CipherViewLikeUtils.isArchived(c))
      ? this.i18nService.t(plan.allowed.length === 1 ? "restoredItem" : "restoredItems")
      : this.i18nService.t(
          plan.allowed.length === 1 ? "archivedItemRestored" : "archivedItemsRestored",
        );

    if (!(await this.reprompt(plan.allowed))) {
      return;
    }

    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const idOf = (c: C) => uuidAsString(c.id as unknown as CipherId);

    try {
      if (org != null) {
        const unassigned = org.canEditAllCiphers
          ? []
          : plan.allowed.filter((c) => CipherViewLikeUtils.isUnassigned(c));
        const assigned = plan.allowed.filter((c) => !unassigned.includes(c));

        await this.cipherService.restoreManyWithServer(
          [...unassigned.map(idOf), ...assigned.map(idOf)],
          userId,
          org.id,
        );
      } else {
        await this.cipherService.restoreManyWithServer(plan.allowed.map(idOf), userId);
      }

      this.toastService.showToast({ variant: "success", message: toastMessage });
      this.reportSkipped(plan.skipped.length);
      this.clearSelection();
      this._completed$.next();
    } catch (e) {
      this.logService.error("Error restoring ciphers", e);
      // Keykeeper: the server restores one at a time and stops at the first it
      // refuses, so some may be restored already. It says so, and the vault is
      // read again so the list shows what happened.
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("keykeeperBulkPartlyFailed"),
      });
      await this.readAgain();
    }
  }

  /**
   * Delete the selected ciphers and/or collections via the bulk-delete dialog.
   * Passes single-item arrays when only one item is selected — no special single-item path.
   * Performs a permanent delete when the current filter is the trash view.
   *
   * Keykeeper: what the person may not delete is left out, and the
   * confirmation says how many, as for {@link bulkRestore}.
   */
  async bulkDelete(): Promise<void> {
    const { isOrgVault, organization: org } = this.config();
    const selected = this.selected();
    const ciphers = selected
      .filter(
        (i) =>
          i.collection === undefined &&
          i.cipher !== undefined &&
          !CipherViewLikeUtils.isPartial(i.cipher),
      )
      .map((i) => i.cipher as C);
    const collections = selected
      .filter((i) => i.collection !== undefined)
      .map((i) => i.collection as CollectionView);

    if (ciphers.length === 0 && collections.length === 0) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("nothingSelected"),
      });
      return;
    }

    const permanent = this.inTrash();

    const folders = splitByAllowed(
      collections,
      collections.map((c) => this.mayDeleteCollection(c, this.allOrganizations())),
    );
    const items = splitByAllowed(
      ciphers,
      ciphers.length === 0
        ? []
        : await firstValueFrom(
            combineLatest(
              ciphers.map((c) => this.cipherAuthorizationService.canDeleteCipher$(c, isOrgVault)),
            ),
          ),
    );

    if (items.allowed.length === 0 && folders.allowed.length === 0) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("missingPermissions"),
      });
      return;
    }

    if (!(await this.reprompt(items.allowed))) {
      return;
    }

    const orgIds = folders.allowed.map((c) => c.organizationId);
    const organizations = this.allOrganizations().filter((o) => orgIds.includes(o.id));

    const unassignedCiphers =
      org != null
        ? items.allowed
            .filter((c) => CipherViewLikeUtils.isUnassigned(c))
            .map((c) => uuidAsString(c.id as unknown as CipherId))
        : [];
    const assignedCipherIds =
      org != null
        ? items.allowed
            .filter((c) => !CipherViewLikeUtils.isUnassigned(c))
            .map((c) => uuidAsString(c.id as unknown as CipherId))
        : items.allowed.map((c) => uuidAsString(c.id as unknown as CipherId));

    const notice = [this.skipNotice("delete", items), this.skipNotice("folders", folders)]
      .filter((n) => n != null)
      .join(" ");

    const result = await this.bulkDeleteDialog.open({
      permanent,
      cipherIds: assignedCipherIds,
      organizations,
      collections: folders.allowed,
      ...(org != null ? { organization: org, unassignedCiphers } : {}),
      ...(notice !== "" ? { notice } : {}),
    });

    if (result === BulkDeleteDialogResult.Deleted) {
      this.reportSkipped(items.skipped.length, folders.skipped.length);
      this.clearSelection();
      this._completed$.next();
    } else if (result === BulkDeleteDialogResult.Failed) {
      await this.readAgain();
    }
  }

  /** Move the selected ciphers to a folder via the bulk-move dialog. */
  async bulkMoveToFolder(): Promise<void> {
    const ciphers = this.selectedCiphers();

    if (!(await this.reprompt(ciphers))) {
      return;
    }

    const selectedCipherIds = ciphers.map((c) => uuidAsString(c.id as unknown as CipherId));
    if (selectedCipherIds.length === 0) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("nothingSelected"),
      });
      return;
    }

    const dialog = openBulkMoveDialog(this.dialogService, {
      data: { cipherIds: selectedCipherIds },
    });

    const result = await lastValueFrom(dialog.closed);
    if (result === BulkMoveDialogResult.Moved) {
      this.clearSelection();
      this._completed$.next();
    }
  }

  /**
   * Open the assign-collections dialog for the selected ciphers.
   * Derives the active collection and available collections from the current route filter.
   *
   * Keykeeper: the dialog is handed only the items the person may move, and
   * says how many were left out. Moving an item into an organization is still
   * the dialog's own work, the same as for one item.
   */
  async bulkAssignToCollections(): Promise<void> {
    const selectedCiphers = this.selectedCiphers();

    if (selectedCiphers.length === 0) {
      this.toastService.showToast({
        variant: "error",
        title: this.i18nService.t("errorOccurred"),
        message: this.i18nService.t("nothingSelected"),
      });
      return;
    }

    const config = this.config();

    // Shared folders belong to one organization, so items of several can't go
    // in one go. Upstream hid the action; this says what to do instead.
    const organizationIds = new Set(
      selectedCiphers.map((c) => c.organizationId).filter((id) => !!id),
    );
    if (organizationIds.size > 1) {
      await this.dialogService.openSimpleDialog({
        title: { key: "assignToCollections" },
        content: { key: "keykeeperBulkSeveralOrganizations" },
        acceptButtonText: { key: "ok" },
        cancelButtonText: null,
        type: "info",
      });
      return;
    }

    const plan = splitByAllowed(
      selectedCiphers,
      selectedCiphers.map((c) => this.mayAssign(c, config, this.allOrganizations())),
    );
    if (plan.allowed.length === 0) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("missingPermissions"),
      });
      return;
    }
    const ciphers = plan.allowed;
    const notice = this.skipNotice("move", plan);

    if (!(await this.reprompt(ciphers))) {
      return;
    }

    const filter = this.routedVaultFilterBridgeService
      ? await firstValueFrom(this.routedVaultFilterBridgeService.activeFilter$)
      : undefined;

    // The host's scope wins — a page that drills in by route segment leaves the filter empty.
    const collectionId = config.activeCollectionId ?? filter?.collectionId;
    const activeCollection =
      collectionId && collectionId !== All && collectionId !== Unassigned
        ? config.allCollections.find((c) => c.id === collectionId)
        : undefined;

    const orgId = filter?.organizationId ?? ciphers.find((c) => !!c.organizationId)?.organizationId;

    let availableCollections: CollectionView[] = [];
    if (orgId && orgId !== "MyVault") {
      const org = this.allOrganizations().find((o) => o.id === orgId);
      availableCollections = config.allCollections.filter((c) => c.organizationId === org?.id);
    }

    // Convert CipherListView to CipherView if necessary
    let ciphersToAssign: CipherView[];
    if (ciphers.some(CipherViewLikeUtils.isCipherListView)) {
      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      ciphersToAssign = await firstValueFrom(
        this.cipherService
          .cipherViews$(userId)
          .pipe(
            map(
              (cipherViews) =>
                cipherViews.filter((cv) => ciphers.some((c) => c.id === cv.id)) as CipherView[],
            ),
          ),
      );
    } else {
      ciphersToAssign = ciphers as unknown as CipherView[];
    }

    const result = await this.assignCollectionsDialog.open({
      ciphers: ciphersToAssign,
      organizationId: orgId as OrganizationId,
      availableCollections,
      activeCollection,
      ...(config.organization != null && ciphersToAssign.length === 1
        ? {
            isSingleCipherAdmin:
              config.organization.canEditAllCiphers ||
              CipherViewLikeUtils.isUnassigned(ciphersToAssign[0]),
          }
        : {}),
      ...(notice != null ? { notice } : {}),
    });

    if (result === AssignCollectionsResult.Saved) {
      this.reportSkipped(plan.skipped.length);
      this.clearSelection();
      this._completed$.next();
    }
  }

  /**
   * Keykeeper: marks the selected items as favorites, or takes them out of
   * the favorites when every one of them already is one. There is no request
   * for several at once, so each goes through the single item's own partial
   * update, with progress in the bar and a count of any that failed.
   */
  async bulkFavorite(): Promise<void> {
    if (!this.canFavorite() || this._progress() != null) {
      return;
    }

    const adds = this.favoriteAdds();
    const ciphers = this.selectedCiphers().filter((c) => !!c.favorite !== adds);
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));

    this._progress.set({ done: 0, total: ciphers.length });
    let failed: number;
    try {
      const run = await runEach(
        ciphers,
        async (c) => {
          const full = await this.cipherService.getFullCipherView(c);
          await saveFavorite(this.apiService, this.cipherService, full, adds, userId);
        },
        (done, total) => this._progress.set({ done, total }),
      );
      failed = run.failed.length;
    } finally {
      this._progress.set(null);
    }

    if (failed > 0) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("keykeeperBulkSomeFailed", failed, ciphers.length),
      });
    } else if (ciphers.length === 1) {
      this.toastService.showToast({
        variant: "success",
        message: this.i18nService.t(adds ? "itemAddedToFavorites" : "itemRemovedFromFavorites"),
      });
    } else {
      this.toastService.showToast({
        variant: "success",
        message: this.i18nService.t(
          adds ? "keykeeperBulkFavorited" : "keykeeperBulkUnfavorited",
          ciphers.length,
        ),
      });
    }

    this.clearSelection();
    this._completed$.next();
  }

  /** Open the bulk-edit-collection-access dialog for the selected collections. No-op when token is not provided. */
  async bulkEditCollectionAccess(): Promise<void> {
    if (!this.bulkEditCollectionAccessDialog) {
      return;
    }

    const { organization: org } = this.config();
    if (!org) {
      return;
    }

    const collections = this.selectedCollections();
    if (collections.length === 0) {
      return;
    }

    const canEditAll = collections.every((c) => c.canEdit(org));
    if (!canEditAll) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("missingPermissions"),
      });
      return;
    }

    const result = await this.bulkEditCollectionAccessDialog.open({
      organizationId: org.id,
      collections,
    });

    if (result === BulkEditCollectionAccessResult.Saved) {
      this.clearSelection();
      this._completed$.next();
    }
  }

  private async reprompt(ciphers: CipherViewLike[]): Promise<boolean> {
    const notProtected = !ciphers.find((c) => c.reprompt !== CipherRepromptType.None);
    return notProtected || (await this.passwordRepromptService.showPasswordPrompt());
  }

  /**
   * Keykeeper: whether one selected item may be moved to shared folders. The
   * rule is the one this bar already asked of every selected item, taken out
   * so it can be asked of each: an item of the person's own always, and an
   * organization's item for an admin who reaches every item, or for someone
   * who can edit it, see its password and share it.
   */
  private mayAssign(c: C, config: VaultBatchBarConfig, organizations: Organization[]): boolean {
    if (!c.organizationId) {
      return true;
    }
    const org = organizations.find((o) => o.id === c.organizationId);
    return (
      org?.canEditAllCiphers === true ||
      (c.edit && c.viewPassword && itemGrid(itemLike(c), config.allCollections).share)
    );
  }

  /** Keykeeper: upstream's rule for deleting one selected collection, asked of each. */
  private mayDeleteCollection(c: CollectionView, organizations: Organization[]): boolean {
    if (c.id === Unassigned) {
      return false;
    }
    return c.canDelete(organizations.find((o) => o.id === c.organizationId));
  }

  /**
   * Keykeeper: the sentence that says, before an action runs, how many of the
   * selected rows it will leave out and why. Undefined when it leaves none.
   */
  private skipNotice(
    action: keyof typeof SKIP_NOTICE,
    plan: BulkPlan<unknown>,
  ): string | undefined {
    const skipped = plan.skipped.length;
    if (skipped === 0) {
      return undefined;
    }
    const total = skipped + plan.allowed.length;
    return skipped === 1
      ? this.i18nService.t(SKIP_NOTICE[action].one, total)
      : this.i18nService.t(SKIP_NOTICE[action].many, skipped, total);
  }

  /** Keykeeper: says, after an action ran, how many rows it left out. */
  private reportSkipped(items: number, folders = 0): void {
    const parts: string[] = [];
    if (items > 0) {
      parts.push(
        items === 1
          ? this.i18nService.t("keykeeperBulkSkippedOne")
          : this.i18nService.t("keykeeperBulkSkipped", items),
      );
    }
    if (folders > 0) {
      parts.push(
        folders === 1
          ? this.i18nService.t("keykeeperBulkSkippedFoldersOne")
          : this.i18nService.t("keykeeperBulkSkippedFolders", folders),
      );
    }
    if (parts.length > 0) {
      this.toastService.showToast({ variant: "info", message: parts.join(" ") });
    }
  }

  /**
   * Keykeeper: after the server refused partway, reads the vault again so the
   * list shows what did change, and lets go of the selection made before it.
   */
  private async readAgain(): Promise<void> {
    try {
      await this.syncService.fullSync(true);
    } catch (e) {
      this.logService.error("Error reading the vault again", e);
    }
    this.clearSelection();
    this._completed$.next();
  }
}
