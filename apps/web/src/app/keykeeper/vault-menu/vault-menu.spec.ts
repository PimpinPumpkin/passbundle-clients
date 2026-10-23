import { Unassigned } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { CollectionId, OrganizationId } from "@bitwarden/common/types/guid";
import { CipherType } from "@bitwarden/common/vault/enums";
import { TreeNode } from "@bitwarden/common/vault/models/domain/tree-node";
import { CipherViewLike } from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import {
  CipherTypeFilter,
  CollectionFilter,
  FolderFilter,
  OrganizationFilter,
  RoutedVaultFilterModel,
} from "@bitwarden/vault";

import {
  buildVaultMenu,
  filterAfter,
  pickedLabel,
  VaultMenuActions,
  VaultMenuState,
} from "./vault-menu";

const ORG = "org-1" as OrganizationId;
const OTHER_ORG = "org-2" as OrganizationId;

function item(
  type: CipherType,
  more: {
    organizationId?: string;
    folderId?: string;
    collectionIds?: string[];
    favorite?: boolean;
    isDeleted?: boolean;
    isArchived?: boolean;
  } = {},
): CipherViewLike {
  return {
    type,
    favorite: false,
    isDeleted: false,
    isArchived: false,
    ...more,
  } as unknown as CipherViewLike;
}

function typeTree(...types: CipherTypeFilter[]) {
  const head = new TreeNode<CipherTypeFilter>(
    { id: "AllItems", name: "allItems", type: "all" },
    null!,
  );
  head.children = types.map((t) => new TreeNode<CipherTypeFilter>(t, head));
  return head;
}

const favorites: CipherTypeFilter = {
  id: "favorites",
  name: "Favorites",
  type: "favorites",
  icon: "bwi-star",
};
const login: CipherTypeFilter = {
  id: "login",
  name: "Login",
  type: CipherType.Login,
  icon: "bwi-globe",
};
const card: CipherTypeFilter = {
  id: "card",
  name: "Card",
  type: CipherType.Card,
  icon: "bwi-credit-card",
};

function organizations() {
  const head = new TreeNode<OrganizationFilter>({ id: "AllVaults" } as OrganizationFilter, null!);
  const myVault = {
    id: "MyVault",
    name: "My vault",
    icon: "bwi-user",
    hideOptions: true,
    enabled: true,
  };
  const contoso = Object.assign(new Organization(), {
    id: ORG,
    name: "Contoso",
    icon: "bwi-business",
    enabled: true,
  });
  const fabrikam = Object.assign(new Organization(), {
    id: OTHER_ORG,
    name: "Fabrikam",
    enabled: false,
  });
  head.children = [myVault, contoso, fabrikam].map(
    (o) => new TreeNode<OrganizationFilter>(o as OrganizationFilter, head),
  );
  return head;
}

function collections() {
  const head = new TreeNode<CollectionFilter>({ id: "AllCollections" } as CollectionFilter, null!);
  const office = new TreeNode<CollectionFilter>(
    {
      id: "c-office",
      name: "Office",
      organizationId: ORG,
      icon: "bwi-collection-shared",
    } as unknown as CollectionFilter,
    head,
  );
  const printers = new TreeNode<CollectionFilter>(
    { id: "c-printers", name: "Printers", organizationId: ORG } as unknown as CollectionFilter,
    office,
  );
  office.children = [printers];
  const other = new TreeNode<CollectionFilter>(
    { id: "c-other", name: "Shared", organizationId: OTHER_ORG } as unknown as CollectionFilter,
    head,
  );
  head.children = [office, other];
  return head;
}

function folders(...names: [string, string][]) {
  const head = new TreeNode<FolderFilter>(
    { id: "AllFolders", name: "folders" } as FolderFilter,
    null!,
  );
  head.children = names.map(
    ([id, name]) =>
      new TreeNode<FolderFilter>({ id, name, icon: "bwi-folder" } as FolderFilter, head),
  );
  return head;
}

const archive = new TreeNode<CipherTypeFilter>(
  { id: "archive", name: "Archive", type: "archive", icon: "bwi-archive" },
  null!,
);
const trash = new TreeNode<CipherTypeFilter>(
  { id: "trash", name: "Trash", type: "trash", icon: "bwi-trash" },
  null!,
);

const ciphers = [
  item(CipherType.Login, { favorite: true, folderId: "f-bank" }),
  item(CipherType.Login, { organizationId: ORG, collectionIds: ["c-office"] }),
  item(CipherType.Card),
  item(CipherType.Card, { isDeleted: true }),
  item(CipherType.Login, { isArchived: true }),
];

function state(
  routed: RoutedVaultFilterModel = {},
  more: Partial<VaultMenuState> = {},
): VaultMenuState {
  return {
    onVault: true,
    routed: { organizationIdParamType: "query", ...routed },
    ciphers,
    allItemsLabel: "All items",
    typeTree: typeTree(favorites, login, card),
    organizationTree: organizations(),
    showVaultsHeading: true,
    collectionTree: collections(),
    folderTree: folders(["f-bank", "Banking"], ["", "No folder"]),
    archive,
    archivePremiumBadge: false,
    trash,
    ...more,
  };
}

function actions(): jest.Mocked<VaultMenuActions> {
  return {
    all: jest.fn(),
    type: jest.fn(),
    organization: jest.fn(),
    collection: jest.fn(),
    folder: jest.fn(),
    archive: jest.fn(),
  };
}

describe("buildVaultMenu", () => {
  it("counts what each entry shows: no trash or archive in the rest", () => {
    const menu = buildVaultMenu(state(), actions());

    expect(menu.all.count).toBe(3);
    expect(menu.favorites?.count).toBe(1);
    expect(menu.categories.map((c) => [c.label, c.count])).toEqual([
      ["Login", 2],
      ["Card", 1],
    ]);
    expect(menu.archive?.count).toBe(1);
    expect(menu.trash?.count).toBe(1);
  });

  it("keeps Favorites out of the categories, at the top", () => {
    const menu = buildVaultMenu(state(), actions());

    expect(menu.favorites?.label).toBe("Favorites");
    expect(menu.categories.map((c) => c.key)).toEqual(["type-login", "type-card"]);
  });

  it("has no Favorites when the type tree has none (nothing is a favorite)", () => {
    const menu = buildVaultMenu(state({}, { typeTree: typeTree(login) }), actions());

    expect(menu.favorites).toBeUndefined();
    expect(menu.categories.map((c) => c.label)).toEqual(["Login"]);
  });

  it("counts inside the vault picked, the way the list filters, and All items counts everything", () => {
    const menu = buildVaultMenu(state({ organizationId: ORG, type: "login" }), actions());

    expect(menu.categories.find((c) => c.key === "type-login")?.count).toBe(1);
    expect(menu.categories.find((c) => c.key === "type-card")?.count).toBe(0);
    expect(menu.all.count).toBe(3);
  });

  it("has no counts while the vault decrypts", () => {
    const menu = buildVaultMenu(state({}, { ciphers: undefined }), actions());

    expect(menu.all.count).toBeUndefined();
    expect(menu.categories[0].count).toBeUndefined();
  });

  it("shows All items as showing when nothing is picked", () => {
    const menu = buildVaultMenu(state(), actions());

    expect(menu.all.active).toBe(true);
    expect(menu.categories.some((c) => c.active)).toBe(false);
  });

  it("shows nothing as picked off the vault's page", () => {
    const menu = buildVaultMenu(
      state({ type: "login", organizationId: ORG }, { onVault: false }),
      actions(),
    );

    expect(menu.all.active).toBe(false);
    expect([...menu.categories, ...menu.vaults].some((e) => e.active || e.scope)).toBe(false);
    // And counts as if nothing were picked.
    expect(menu.categories.find((c) => c.key === "type-login")?.count).toBe(2);
  });

  it("shows the category picked, and the vault it's in as the scope", () => {
    const menu = buildVaultMenu(state({ organizationId: ORG, type: "login" }), actions());
    const contoso = menu.vaults.find((v) => v.key === `vault-${ORG}`)!;

    expect(menu.all.active).toBe(false);
    expect(menu.categories.find((c) => c.key === "type-login")?.active).toBe(true);
    expect(contoso.active).toBe(false);
    expect(contoso.scope).toBe(true);
  });

  it("shows a vault as showing when only it is picked", () => {
    const menu = buildVaultMenu(state({ organizationId: Unassigned }), actions());
    const myVault = menu.vaults.find((v) => v.key === "vault-MyVault")!;

    expect(myVault.active).toBe(true);
    expect(myVault.scope).toBe(false);
    expect(myVault.count).toBe(2);
  });

  it("lists each vault with its collections right after it, a level in", () => {
    const menu = buildVaultMenu(state(), actions());

    expect(menu.vaults.map((v) => [v.label, v.depth])).toEqual([
      ["My vault", 0],
      ["Contoso", 0],
      ["Office", 1],
      ["Printers", 2],
      ["Fabrikam", 0],
      ["Shared", 1],
    ]);
    expect(menu.vaults.find((v) => v.key === "collection-c-office")?.count).toBe(1);
  });

  it("offers an organization's options, and not My vault's", () => {
    const menu = buildVaultMenu(state(), actions());

    expect(menu.vaults.find((v) => v.key === "vault-MyVault")?.organization).toBeUndefined();
    expect(menu.vaults.find((v) => v.key === `vault-${ORG}`)?.organization?.id).toBe(ORG);
    expect(menu.vaults.find((v) => v.key === `vault-${OTHER_ORG}`)?.organization?.enabled).toBe(
      false,
    );
  });

  it("lists folders with No folder, which only shows next to a real folder", () => {
    const withFolders = buildVaultMenu(state({ folderId: "f-bank" }), actions());
    expect(withFolders.folders.map((f) => [f.label, f.count, f.active])).toEqual([
      ["Banking", 1, true],
      ["No folder", 2, false],
    ]);
    expect(withFolders.folders[0].folder?.id).toBe("f-bank");
    expect(withFolders.folders[1].folder).toBeUndefined();

    const without = buildVaultMenu(
      state({}, { folderTree: folders(["", "No folder"]) }),
      actions(),
    );
    expect(without.folders).toEqual([]);
  });

  it("nests folders inside folders", () => {
    const tree = folders(["f-work", "Work"]);
    const child = new TreeNode<FolderFilter>(
      { id: "f-clients", name: "Clients" } as FolderFilter,
      tree.children[0],
    );
    tree.children[0].children = [child];

    const menu = buildVaultMenu(state({}, { folderTree: tree }), actions());

    expect(menu.folders.map((f) => [f.label, f.depth])).toEqual([
      ["Work", 0],
      ["Clients", 1],
    ]);
  });

  it("follows the folders heading upstream names", () => {
    const tree = folders(["f-bank", "Banking"]);
    tree.node.name = "myFolders";

    expect(buildVaultMenu(state({}, { folderTree: tree }), actions()).foldersHeading).toBe(
      "myFolders",
    );
  });

  it("shows Archive and Trash as picked, with the premium badge when asked", () => {
    const menu = buildVaultMenu(state({ type: "trash" }, { archivePremiumBadge: true }), actions());

    expect(menu.trash?.active).toBe(true);
    expect(menu.archive?.active).toBe(false);
    expect(menu.archive?.premiumBadge).toBe(true);
    expect(menu.all.active).toBe(false);
  });

  it("picks through the panel's actions, with the tree nodes they take", async () => {
    const act = actions();
    const menu = buildVaultMenu(state(), act);

    await menu.all.select();
    await menu.categories[1].select();
    await menu.vaults[1].select();
    await menu.vaults[2].select();
    await menu.folders[0].select();
    await menu.archive!.select();
    await menu.trash!.select();

    expect(act.all).toHaveBeenCalled();
    expect(act.type).toHaveBeenCalledWith(expect.objectContaining({ node: card }));
    expect(act.organization.mock.calls[0][0].node.id).toBe(ORG);
    expect(act.collection.mock.calls[0][0].node.id).toBe("c-office");
    expect(act.folder.mock.calls[0][0].node.id).toBe("f-bank");
    expect(act.archive).toHaveBeenCalledWith(archive);
    expect(act.type).toHaveBeenCalledWith(trash);
  });
});

describe("pickedLabel", () => {
  const titleFor = (routed: RoutedVaultFilterModel, more: Partial<VaultMenuState> = {}) =>
    pickedLabel(buildVaultMenu(state(routed, more), actions()));

  it("is the name of the entry showing, for the vault page's title", () => {
    expect(titleFor({})).toBe("All items");
    expect(titleFor({ type: "favorites" })).toBe("Favorites");
    expect(titleFor({ type: "card" })).toBe("Card");
    expect(titleFor({ organizationId: ORG })).toBe("Contoso");
    expect(titleFor({ organizationId: Unassigned })).toBe("My vault");
    expect(titleFor({ organizationId: ORG, collectionId: "c-printers" as CollectionId })).toBe(
      "Printers",
    );
    expect(titleFor({ folderId: "f-bank" })).toBe("Banking");
    expect(titleFor({ folderId: Unassigned })).toBe("No folder");
    expect(titleFor({ type: "archive" })).toBe("Archive");
    expect(titleFor({ type: "trash" })).toBe("Trash");
  });

  it("is the category inside a vault, not the vault around it", () => {
    expect(titleFor({ organizationId: ORG, type: "login" })).toBe("Login");
  });

  it("is nothing off the vault's page, or for a filter the menu has no entry for", () => {
    expect(titleFor({ type: "login" }, { onVault: false })).toBeUndefined();
    expect(titleFor({ collectionId: Unassigned })).toBeUndefined();
  });
});

describe("filterAfter", () => {
  const routed: RoutedVaultFilterModel = {
    organizationId: ORG,
    collectionId: "c-office" as CollectionId,
    organizationIdParamType: "query",
  };

  it("is where the routed filter goes for a category: the vault stays, the collection goes", () => {
    const node = new TreeNode<CipherTypeFilter>(card, null!);

    expect(filterAfter(routed, (f) => (f.selectedCipherTypeNode = node))).toEqual({
      organizationId: ORG,
      organizationIdParamType: "query",
      type: "card",
      folderId: undefined,
      collectionId: undefined,
    });
  });

  it("clears everything for All items", () => {
    expect(filterAfter(routed, (f) => f.resetFilter())).toEqual({
      organizationIdParamType: "query",
      organizationId: undefined,
      collectionId: undefined,
      folderId: undefined,
      type: undefined,
    });
  });
});
