import { Unassigned } from "@bitwarden/common/admin-console/models/collections";
import { categoryOfType, KeykeeperCategory } from "@bitwarden/common/vault/keykeeper/categories";
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
 * what the panel showed. Every place an item lives is a folder: Personal with
 * its folders, then each organization with its shared folders (DESIGN.md,
 * "Folders and permissions").
 */

/** One row of the menu. */
export interface VaultMenuEntry {
  /** Stable, for tracking rows. */
  key: string;
  label: string;
  icon?: BitwardenIcon;
  /**
   * The jewel tile it shows in the open menu, in place of its icon: All
   * items, Favorites, and the categories (DESIGN.md, "The look").
   */
  tile?: KeykeeperCategory;
  /** How many items the list shows once this is picked, as things are now. */
  count?: number;
  /** Nesting: folders inside Personal or their organization, and inside their parent. */
  depth: number;
  /** The list shows this now. */
  active: boolean;
  /** Personal or the organization the entry showing now is inside of, such as a category in it. */
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
  /**
   * Personal with the person's own folders right after it, a level in, then
   * each organization with its shared folders.
   */
  places: VaultMenuEntry[];
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
  /** A personal folder, whatever Personal or organization was showing (folderPick). */
  folder: (node: TreeNode<FolderFilter>) => Promise<void>;
  archive: (node: TreeNode<CipherTypeFilter>) => Promise<void>;
}

/**
 * Where picking a personal folder goes: the folder, out of any organization
 * showing. A personal folder holds whatever its owner filed there, so it
 * isn't inside Personal or an organization the way a category is. "No
 * folder" sits under Personal too, so it's Personal's items in no folder.
 */
export function folderPick(
  routed: RoutedVaultFilterModel,
  node: TreeNode<FolderFilter>,
): RoutedVaultFilterModel {
  const owner =
    routed.organizationIdParamType === "path"
      ? routed.organizationId
      : node.node.id
        ? undefined
        : Unassigned;
  return filterAfter({ ...routed, organizationId: owner }, (f) => (f.selectedFolderNode = node));
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

/** A kind of item's tile, and Favorites'. Archive and Trash keep their icons. */
function tileOf(type: CipherTypeFilter["type"]): KeykeeperCategory | undefined {
  if (type === "favorites") {
    return "favorites";
  }
  return typeof type === "number" ? categoryOfType(type) : undefined;
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
    tile: tileOf(tree.node.type),
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
    tile: "all",
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

  // Keykeeper: the person's own folders, under Personal. "No folder" (its
  // id is empty) is only worth a row next to real folders.
  const folderTrees = state.folderTree?.children ?? [];
  const hasFolders = folderTrees.some((f) => !!f.node.id);
  const personalFolders = flatten(
    folderTrees.filter((f) => hasFolders || !!f.node.id),
    1,
  ).map(({ tree, depth }): VaultMenuEntry => ({
    key: `folder-${tree.node.id || "none"}`,
    label: tree.node.name ?? "",
    icon: tree.node.icon ?? "bwi-folder",
    count:
      ciphers == null
        ? undefined
        : ciphers.filter((c) => createFilterFunction(folderPick(routed, tree))(c)).length,
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

  const collections = state.collectionTree?.children ?? [];
  const places = (state.organizationTree?.children ?? []).flatMap((org) => {
    const personal = org.node.id === "MyVault";
    const routedId = personal ? Unassigned : org.node.id;
    const isPlace = routed.organizationId === routedId;
    const place: VaultMenuEntry = {
      key: `vault-${org.node.id}`,
      label: org.node.name ?? "",
      icon: org.node.icon,
      count: countAfter(ciphers, routed, (f) => (f.selectedOrganizationNode = org)),
      depth: 0,
      active: picked(isPlace && onlyVault),
      scope: picked(isPlace && !onlyVault && routed.folderId === undefined),
      select: () => actions.organization(org),
      organization: org.node.hideOptions ? undefined : org.node,
    };
    if (personal) {
      return [place, ...personalFolders];
    }
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
    return [place, ...inside];
  });

  return {
    all,
    favorites: favorites ? typeEntry(favorites, actions.type) : undefined,
    categories,
    places,
    archive: state.archive
      ? { ...typeEntry(state.archive, actions.archive), premiumBadge: state.archivePremiumBadge }
      : undefined,
    trash: state.trash ? typeEntry(state.trash, actions.type) : undefined,
  };
}

/**
 * The name of the entry showing now, for the vault page's title, so the
 * title says what the menu does: All items, a category, Personal, an
 * organization, a folder, Favorites, Archive, or Trash. Undefined when
 * nothing in the menu is showing (off the vault's page, or a filter it has no
 * entry for).
 */
export function pickedLabel(menu: VaultMenu): string | undefined {
  const entries = [
    menu.all,
    menu.favorites,
    ...menu.categories,
    ...menu.places,
    menu.archive,
    menu.trash,
  ];
  return entries.find((entry) => entry?.active)?.label || undefined;
}
