import { Unassigned } from "@bitwarden/common/admin-console/models/collections";
import { ITreeNodeObject, TreeNode } from "@bitwarden/common/vault/models/domain/tree-node";
import { CipherViewLike } from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import { BitwardenIcon } from "@bitwarden/components";
import {
  CipherTypeFilter,
  CollectionFilter,
  createFilterFunction,
  FolderFilter,
  OrganizationFilter,
  RoutedVaultFilterBridge,
  RoutedVaultFilterBridgeService,
  RoutedVaultFilterModel,
  VaultFilter,
} from "@bitwarden/vault";

/**
 * Keykeeper: the vault's part of the web vault's one left menu (DESIGN.md,
 * "The left menu"). It's built from the trees the old filter panel used, and
 * picking an entry goes through the same routed filter, so the list shows
 * what the panel showed.
 */

/** One row of the menu. */
export interface VaultMenuEntry {
  /** Stable, for tracking rows. */
  key: string;
  label: string;
  icon?: BitwardenIcon;
  /** How many items the list shows once this is picked, as things are now. */
  count?: number;
  /** Nesting: collections inside their vault, folders inside their parent. */
  depth: number;
  /** The list shows this now. */
  active: boolean;
  /** The vault that the entry showing now is inside of, such as a category in it. */
  scope: boolean;
  select: () => Promise<void>;
  /** One of the person's own folders, which they can edit. */
  folder?: FolderFilter;
  /** An organization, for its options menu and its suspended warning. */
  organization?: OrganizationFilter;
  /** Archive, when it needs premium. */
  premiumBadge?: boolean;
}

export interface VaultMenu {
  all: VaultMenuEntry;
  favorites?: VaultMenuEntry;
  categories: VaultMenuEntry[];
  showVaultsHeading: boolean;
  /** Each vault, with its collections right after it, a level in. */
  vaults: VaultMenuEntry[];
  /** The folders heading's message key, which follows upstream's naming. */
  foldersHeading: string;
  folders: VaultMenuEntry[];
  archive?: VaultMenuEntry;
  trash?: VaultMenuEntry;
}

/** What the menu is built from. */
export interface VaultMenuState {
  /** Whether the vault's page is showing. Elsewhere, nothing is picked. */
  onVault: boolean;
  routed: RoutedVaultFilterModel;
  /** Items the person may see. Undefined while they load. */
  ciphers?: CipherViewLike[];
  allItemsLabel: string;
  /** All items, with the categories that have items (and the one showing). */
  typeTree?: TreeNode<CipherTypeFilter>;
  organizationTree?: TreeNode<OrganizationFilter>;
  showVaultsHeading: boolean;
  collectionTree?: TreeNode<CollectionFilter>;
  folderTree?: TreeNode<FolderFilter>;
  archive?: TreeNode<CipherTypeFilter>;
  archivePremiumBadge: boolean;
  trash?: TreeNode<CipherTypeFilter>;
}

/** What picking each kind of entry does: the old filter panel's actions. */
export interface VaultMenuActions {
  all: () => Promise<void>;
  type: (node: TreeNode<CipherTypeFilter>) => Promise<void>;
  organization: (node: TreeNode<OrganizationFilter>) => Promise<void>;
  collection: (node: TreeNode<CollectionFilter>) => Promise<void>;
  folder: (node: TreeNode<FolderFilter>) => Promise<void>;
  archive: (node: TreeNode<CipherTypeFilter>) => Promise<void>;
}

/**
 * Where the routed filter goes when an entry is picked, worked out by the
 * routed filter's own model, so a count is what picking its entry shows.
 */
export function filterAfter(
  routed: RoutedVaultFilterModel,
  pick: (filter: VaultFilter) => void,
): RoutedVaultFilterModel {
  let next = routed;
  const capture = {
    navigate: (filter: RoutedVaultFilterModel) => (next = filter),
  } as unknown as RoutedVaultFilterBridgeService;
  pick(new RoutedVaultFilterBridge(routed, new VaultFilter(), capture));
  return next;
}

function countAfter(
  ciphers: CipherViewLike[] | undefined,
  routed: RoutedVaultFilterModel,
  pick: (filter: VaultFilter) => void,
): number | undefined {
  if (ciphers == null) {
    return undefined;
  }
  const keep = createFilterFunction(filterAfter(routed, pick));
  return ciphers.filter((c) => keep(c)).length;
}

/** Depth first: each node, then its children a level in. */
function flatten<T extends ITreeNodeObject>(
  nodes: TreeNode<T>[],
  depth: number,
): { tree: TreeNode<T>; depth: number }[] {
  return nodes.flatMap((tree) => [{ tree, depth }, ...flatten(tree.children, depth + 1)]);
}

export function buildVaultMenu(state: VaultMenuState, actions: VaultMenuActions): VaultMenu {
  // Off the vault's page its filters aren't in the address, so nothing counts as picked.
  const routed: RoutedVaultFilterModel = state.onVault
    ? state.routed
    : { organizationIdParamType: state.routed.organizationIdParamType };
  const ciphers = state.ciphers;
  const onlyVault =
    routed.type === undefined && routed.folderId === undefined && routed.collectionId === undefined;
  const picked = (match: boolean) => state.onVault && match;

  const typeEntry = (
    tree: TreeNode<CipherTypeFilter>,
    select: (node: TreeNode<CipherTypeFilter>) => Promise<void>,
  ): VaultMenuEntry => ({
    key: `type-${tree.node.id}`,
    label: tree.node.name ?? "",
    icon: tree.node.icon,
    count: countAfter(ciphers, routed, (f) => (f.selectedCipherTypeNode = tree)),
    depth: 0,
    active: picked(routed.type === tree.node.id),
    scope: false,
    select: () => select(tree),
  });

  const all: VaultMenuEntry = {
    key: "all",
    label: state.allItemsLabel,
    icon: "bwi-grid",
    count: countAfter(ciphers, routed, (f) => f.resetFilter()),
    depth: 0,
    active: picked(onlyVault && routed.organizationId === undefined),
    scope: false,
    select: () => actions.all(),
  };

  const types = state.typeTree?.children ?? [];
  const favorites = types.find((t) => t.node.type === "favorites");
  const categories = types
    .filter((t) => t.node.type !== "favorites")
    .map((t) => typeEntry(t, actions.type));

  const collections = state.collectionTree?.children ?? [];
  const vaults = (state.organizationTree?.children ?? []).flatMap((org) => {
    const routedId = org.node.id === "MyVault" ? Unassigned : org.node.id;
    const isVault = routed.organizationId === routedId;
    const vault: VaultMenuEntry = {
      key: `vault-${org.node.id}`,
      label: org.node.name ?? "",
      icon: org.node.icon,
      count: countAfter(ciphers, routed, (f) => (f.selectedOrganizationNode = org)),
      depth: 0,
      active: picked(isVault && onlyVault),
      scope: picked(isVault && !onlyVault),
      select: () => actions.organization(org),
      organization: org.node.hideOptions ? undefined : org.node,
    };
    const inside = flatten(
      collections.filter((c) => c.node.organizationId === org.node.id),
      1,
    ).map(({ tree, depth }): VaultMenuEntry => ({
      key: `collection-${tree.node.id}`,
      label: tree.node.name ?? "",
      icon: tree.node.icon,
      count: countAfter(ciphers, routed, (f) => (f.selectedCollectionNode = tree)),
      depth,
      active: picked(routed.collectionId === tree.node.id),
      scope: false,
      select: () => actions.collection(tree),
    }));
    return [vault, ...inside];
  });

  // "No folder" (its id is empty) is only worth a row next to real folders.
  const folderTrees = state.folderTree?.children ?? [];
  const hasFolders = folderTrees.some((f) => !!f.node.id);
  const folders = flatten(
    folderTrees.filter((f) => hasFolders || !!f.node.id),
    0,
  ).map(({ tree, depth }): VaultMenuEntry => ({
    key: `folder-${tree.node.id || "none"}`,
    label: tree.node.name ?? "",
    icon: tree.node.icon ?? "bwi-folder",
    count: countAfter(ciphers, routed, (f) => (f.selectedFolderNode = tree)),
    depth,
    active: picked(
      !tree.node.id
        ? routed.folderId === Unassigned || routed.folderId === ""
        : routed.folderId === tree.node.id,
    ),
    scope: false,
    select: () => actions.folder(tree),
    folder: tree.node.id ? tree.node : undefined,
  }));

  return {
    all,
    favorites: favorites ? typeEntry(favorites, actions.type) : undefined,
    categories,
    showVaultsHeading: state.showVaultsHeading,
    vaults,
    foldersHeading: state.folderTree?.node.name ?? "folders",
    folders,
    archive: state.archive
      ? { ...typeEntry(state.archive, actions.archive), premiumBadge: state.archivePremiumBadge }
      : undefined,
    trash: state.trash ? typeEntry(state.trash, actions.type) : undefined,
  };
}

/**
 * The name of the entry showing now, for the vault page's title, so the
 * title says what the menu does: All items, a category, a vault, a
 * collection, a folder, Favorites, Archive, or Trash. Undefined when nothing
 * in the menu is showing (off the vault's page, or a filter it has no entry
 * for).
 */
export function pickedLabel(menu: VaultMenu): string | undefined {
  const entries = [
    menu.all,
    menu.favorites,
    ...menu.categories,
    ...menu.vaults,
    ...menu.folders,
    menu.archive,
    menu.trash,
  ];
  return entries.find((entry) => entry?.active)?.label || undefined;
}
