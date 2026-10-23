// Keykeeper: what a person or group can do in a shared folder (upstream's
// collection), as a grid of capabilities instead of upstream's five presets.
// The server enforces see items, create, edit, delete, manage, and view item
// history; the apps enforce see passwords, export, print, and share, since
// anyone who can decrypt an item can take it out with their own tools. See
// DESIGN.md, "Folders and permissions". The server's copy of these rules is
// passbundle-server's src/db/models/keykeeper_folder_permissions.rs; the two
// must agree.

/** Every capability but "see items", which is having the folder at all. */
export type FolderGrid = {
  seePasswords: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  share: boolean;
  print: boolean;
  viewHistory: boolean;
  manage: boolean;
};

export type FolderCapability = keyof FolderGrid;

/** In the order the grid shows them, with their message keys. */
export const FOLDER_CAPABILITIES: readonly { key: FolderCapability; label: string }[] = [
  { key: "seePasswords", label: "keykeeperCapSeePasswords" },
  { key: "create", label: "keykeeperCapCreate" },
  { key: "edit", label: "keykeeperCapEdit" },
  { key: "delete", label: "keykeeperCapDelete" },
  { key: "export", label: "keykeeperCapExport" },
  { key: "share", label: "keykeeperCapShare" },
  { key: "print", label: "keykeeperCapPrint" },
  { key: "viewHistory", label: "keykeeperCapViewHistory" },
  { key: "manage", label: "keykeeperCapManage" },
];

export const GRID_NONE: Readonly<FolderGrid> = Object.freeze({
  seePasswords: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
  share: false,
  print: false,
  viewHistory: false,
  manage: false,
});

export const GRID_ALL: Readonly<FolderGrid> = Object.freeze({
  seePasswords: true,
  create: true,
  edit: true,
  delete: true,
  export: true,
  share: true,
  print: true,
  viewHistory: true,
  manage: true,
});

export type FolderPreset = "view" | "viewHidden" | "edit" | "manage";

/** The presets the access selector offers, besides Custom. */
export const FOLDER_PRESETS: Readonly<Record<FolderPreset, Readonly<FolderGrid>>> = Object.freeze({
  view: Object.freeze({ ...GRID_NONE, seePasswords: true, print: true, viewHistory: true }),
  viewHidden: Object.freeze({ ...GRID_NONE, viewHistory: true }),
  edit: Object.freeze({
    ...GRID_NONE,
    seePasswords: true,
    create: true,
    edit: true,
    delete: true,
    share: true,
    print: true,
    viewHistory: true,
  }),
  manage: GRID_ALL,
});

/** Upstream's three fields on a grant. */
export type UpstreamGrant = {
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
};

/**
 * The grid upstream's fields name, as the server reads a grant saved without
 * one. Upstream's "Can edit except passwords" keeps what upstream let it do,
 * without the capabilities that need see passwords.
 */
export function presetGrid(upstream: UpstreamGrant): FolderGrid {
  if (upstream.manage) {
    return { ...GRID_ALL };
  }
  const seePasswords = !upstream.hidePasswords;
  const edit = !upstream.readOnly;
  return {
    seePasswords,
    create: edit,
    edit,
    delete: edit,
    export: false,
    share: edit && seePasswords,
    print: seePasswords,
    viewHistory: true,
    manage: false,
  };
}

/** Upstream's fields for a grid: the closest preset, which upstream clients show. */
export function upstreamOf(grid: FolderGrid): UpstreamGrant {
  return grid.manage
    ? { readOnly: false, hidePasswords: false, manage: true }
    : { readOnly: !grid.edit, hidePasswords: !grid.seePasswords, manage: false };
}

/** A grant's grid: the server's when it sent one, otherwise its upstream preset. */
export function gridOf(grant: UpstreamGrant & { keykeeper?: FolderGrid | null }): FolderGrid {
  return grant.keykeeper ? { ...GRID_NONE, ...grant.keykeeper } : presetGrid(grant);
}

/** The preset a grid is, or "custom". */
export function presetOf(grid: FolderGrid): FolderPreset | "custom" {
  for (const [name, preset] of Object.entries(FOLDER_PRESETS) as [FolderPreset, FolderGrid][]) {
    if (sameGrid(grid, preset)) {
      return name;
    }
  }
  return "custom";
}

export function sameGrid(a: FolderGrid, b: FolderGrid): boolean {
  return FOLDER_CAPABILITIES.every(({ key }) => !!a[key] === !!b[key]);
}

/**
 * Someone with several ways into a folder, or an item in several folders: for
 * each capability, the most open way. So see passwords is off only while
 * every way turns it off, as the Access page and the server decide.
 */
export function mergeGrids(grids: FolderGrid[]): FolderGrid | undefined {
  if (grids.length === 0) {
    return undefined;
  }
  const merged = { ...GRID_NONE };
  for (const grid of grids) {
    for (const { key } of FOLDER_CAPABILITIES) {
      merged[key] = merged[key] || !!grid[key];
    }
  }
  return merged;
}

/** Every capability in `grid` is also in `own`. */
export function gridWithin(grid: FolderGrid, own: FolderGrid): boolean {
  return FOLDER_CAPABILITIES.every(({ key }) => !grid[key] || !!own[key]);
}

/**
 * The grid's rules, as the server checks them: export, print, and share need
 * see passwords; manage includes everything. Returns the message key of the
 * rule a grid breaks, or undefined.
 */
export function gridProblem(grid: FolderGrid): string | undefined {
  if (grid.manage && !sameGrid(grid, GRID_ALL)) {
    return "keykeeperGridManageIncludesAll";
  }
  if ((grid.export || grid.print || grid.share) && !grid.seePasswords) {
    return "keykeeperGridNeedsSeePasswords";
  }
  return undefined;
}

/**
 * The grid after someone turns one capability on or off in the editor, kept
 * within the rules: turning on export, print, or share turns on see
 * passwords, and turning see passwords off turns them off; turning manage on
 * turns everything on, and turning anything off turns manage off.
 */
export function toggleCapability(
  grid: FolderGrid,
  capability: FolderCapability,
  on: boolean,
): FolderGrid {
  if (capability === "manage") {
    return on ? { ...GRID_ALL } : { ...grid, manage: false };
  }
  const next = { ...grid, [capability]: on };
  if (!on) {
    next.manage = false;
    if (capability === "seePasswords") {
      next.export = false;
      next.print = false;
      next.share = false;
    }
  } else if (capability === "export" || capability === "print" || capability === "share") {
    next.seePasswords = true;
  }
  return next;
}

/** A collection's capabilities, as the apps hold them from sync. */
export type FolderLike = {
  id: string;
  organizationId: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  keykeeper?: FolderGrid | null;
};

/** An item, as far as its capabilities go. */
export type ItemLike = {
  organizationId?: string | null;
  collectionIds?: string[] | null;
};

/**
 * An item's owner and folders as ItemLike, from any item the apps hold,
 * including the SDK's list items, whose ids are tagged strings.
 */
export function itemLike(item: {
  organizationId?: unknown;
  collectionIds?: readonly unknown[] | null;
}): ItemLike {
  return {
    organizationId: item.organizationId == null ? null : String(item.organizationId),
    collectionIds: (item.collectionIds ?? []).map(String),
  };
}

/**
 * What someone can do with an item: everything with their own; otherwise what
 * any shared folder holding it allows them (the server's rule). An item in no
 * folder they reach gets `fallback`, such as everything for an admin, who
 * reaches every item.
 */
export function itemGrid(
  item: ItemLike,
  folders: FolderLike[],
  fallback: FolderGrid = GRID_NONE,
): FolderGrid {
  if (item.organizationId == null) {
    return { ...GRID_ALL };
  }
  const ids = new Set(item.collectionIds ?? []);
  const grids = folders
    .filter((f) => f.organizationId === item.organizationId && ids.has(f.id))
    .map((f) => gridOf(f));
  return mergeGrids(grids) ?? { ...fallback };
}
