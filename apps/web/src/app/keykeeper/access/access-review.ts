// Keykeeper: who can see what in an organization, computed in the browser
// from what the admin console already loads: members with their shared folders
// (upstream's collections) and groups, groups with their shared folders, and
// the organization's items. Nothing here talks to the server. See DESIGN.md,
// "Access and offboarding".

import {
  FOLDER_CAPABILITIES,
  FolderGrid,
  gridOf,
  mergeGrids,
  presetOf,
  upstreamOf,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { CipherType } from "@bitwarden/common/vault/enums";

/**
 * Who gets the Access page and the summaries when removing someone: whoever
 * manages members (owners, admins, and custom roles that manage members).
 * Account recovery alone opens the Members page but not this: the server
 * doesn't give that role the shared folders' details.
 */
export function canReviewAccess(org: Organization): boolean {
  return org.canManageUsers;
}

/**
 * How someone reaches a shared folder: upstream's three fields, and the
 * grant's grid of capabilities, which decides (DESIGN.md, "Folders and
 * permissions"). Without a grid, upstream's fields name its preset.
 */
export type AccessFlags = {
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  keykeeper?: FolderGrid;
};

/** A grant to one shared folder (its id), directly or to a group. */
export type AccessGrant = AccessFlags & { id: string };

/** The permission in plain words: a preset, or Custom with its capabilities. */
export type AccessLevel = "manage" | "edit" | "view" | "viewHidden" | "custom";

export type AccessRole = "owner" | "admin" | "user" | "custom";

/**
 * Confirmed members hold the organization's key. Pending ones (invited, or
 * accepted and waiting for confirmation) never had it, so they never saw an
 * item. Revoked ones had it until they were revoked.
 */
export type AccessStatus = "confirmed" | "pending" | "revoked";

export type AccessMemberInput = {
  /** The membership id. */
  id: string;
  name: string | null;
  email: string;
  role: AccessRole;
  status: AccessStatus;
  /**
   * Sees every item without being an owner or admin: upstream's custom role
   * with "Manage all collections", or MSP staff given vault items.
   */
  allItems: boolean;
  /** Comes from the MSP that manages the organization. */
  mspStaff: boolean;
  /** Shared folders given to them directly. */
  collections: AccessGrant[];
  /** The groups they're in, by id. */
  groups: string[];
};

export type AccessGroupInput = {
  id: string;
  /** Unknown when the viewer can't list groups. */
  name: string | null;
  collections: AccessGrant[];
};

export type AccessFolderInput = { id: string; name: string };

export type AccessItemInput = {
  id: string;
  name: string;
  type: CipherType;
  collectionIds: string[];
  deleted: boolean;
};

export type AccessReviewInput = {
  members: AccessMemberInput[];
  groups: AccessGroupInput[];
  /** The shared folders the viewer can see; grants to any other folder are left out. */
  folders: AccessFolderInput[];
  items: AccessItemInput[];
  /** Upstream's allowAdminAccessToAllCollectionItems: owners and admins see every item. */
  adminsSeeEverything: boolean;
};

/** One way to reach a folder: directly (no group) or through a group. */
export type AccessPath = {
  groupId: string | null;
  groupName: string | null;
  flags: AccessFlags;
  level: AccessLevel;
};

export type FolderAccess = {
  folder: AccessFolderInput;
  /** Every path merged: the most open permission wins. */
  flags: AccessFlags;
  level: AccessLevel;
  paths: AccessPath[];
  itemCount: number;
};

/** Why someone sees every item, if they do. */
export type EveryItemReason = "owner" | "admin" | "allItems";

export type MemberAccess = {
  member: AccessMemberInput;
  everyItem: EveryItemReason | null;
  /** Empty for people who see every item. */
  folders: FolderAccess[];
};

export type FolderPerson = {
  member: AccessMemberInput;
  flags: AccessFlags;
  level: AccessLevel;
  paths: AccessPath[];
};

export type FolderReview = {
  folder: AccessFolderInput;
  itemCount: number;
  people: FolderPerson[];
  /** Owners, admins, and others who see every item, and so this folder too. */
  everyItemPeople: AccessMemberInput[];
};

export type AccessReview = {
  members: MemberAccess[];
  folders: FolderReview[];
  /** Items in the organization that aren't in the trash. */
  itemCount: number;
  /** Ids of the items in each shared folder, leaving out the trash. */
  itemsByFolder: Map<string, Set<string>>;
};

/** The preset a grant's grid is, or Custom. */
export function levelOf(flags: AccessFlags): AccessLevel {
  return presetOf(gridOf(flags));
}

/**
 * Someone who reaches a folder more than one way gets, for each capability,
 * the most open of them, as the server decides: so passwords stay hidden only
 * if every way hides them.
 */
export function mergeFlags(paths: AccessFlags[]): AccessFlags {
  const grid = mergeGrids(paths.map(gridOf))!;
  return { ...upstreamOf(grid), keykeeper: grid };
}

const flagsOf = (g: AccessFlags): AccessFlags => {
  const grid = gridOf({
    readOnly: !!g.readOnly,
    hidePasswords: !!g.hidePasswords,
    manage: !!g.manage,
    keykeeper: g.keykeeper,
  });
  return { ...upstreamOf(grid), keykeeper: grid };
};

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

const memberLabel = (m: AccessMemberInput) => m.name || m.email;

function everyItemReason(
  m: AccessMemberInput,
  adminsSeeEverything: boolean,
): EveryItemReason | null {
  if (adminsSeeEverything && m.role === "owner") {
    return "owner";
  }
  if (adminsSeeEverything && m.role === "admin") {
    return "admin";
  }
  return m.allItems ? "allItems" : null;
}

/** Item ids by folder, leaving out the trash. */
function itemsByFolder(items: AccessItemInput[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.deleted) {
      continue;
    }
    for (const id of item.collectionIds ?? []) {
      let set = result.get(id);
      if (!set) {
        set = new Set();
        result.set(id, set);
      }
      set.add(item.id);
    }
  }
  return result;
}

/** Who reaches which shared folder, how, and with what permission. */
export function reviewAccess(input: AccessReviewInput): AccessReview {
  const folders = [...input.folders].sort((a, b) => byName(a.name, b.name));
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const groupById = new Map(input.groups.map((g) => [g.id, g]));
  const counts = itemsByFolder(input.items);
  const countIn = (folderId: string) => counts.get(folderId)?.size ?? 0;

  const members: MemberAccess[] = [...input.members]
    .sort((a, b) => byName(memberLabel(a), memberLabel(b)))
    .map((member): MemberAccess => {
      const everyItem = everyItemReason(member, input.adminsSeeEverything);
      if (everyItem) {
        return { member, everyItem, folders: [] };
      }
      const paths = new Map<string, AccessPath[]>();
      const add = (folderId: string, path: AccessPath) => {
        if (!folderById.has(folderId)) {
          return;
        }
        paths.set(folderId, [...(paths.get(folderId) ?? []), path]);
      };
      for (const grant of member.collections ?? []) {
        const flags = flagsOf(grant);
        add(grant.id, { groupId: null, groupName: null, flags, level: levelOf(flags) });
      }
      for (const groupId of member.groups ?? []) {
        const group = groupById.get(groupId);
        for (const grant of group?.collections ?? []) {
          const flags = flagsOf(grant);
          add(grant.id, {
            groupId,
            groupName: group?.name ?? null,
            flags,
            level: levelOf(flags),
          });
        }
      }
      const reached: FolderAccess[] = folders
        .filter((f) => paths.has(f.id))
        .map((folder) => {
          const folderPaths = paths.get(folder.id)!;
          const flags = mergeFlags(folderPaths.map((p) => p.flags));
          return {
            folder,
            flags,
            level: levelOf(flags),
            // Direct first, then groups by name.
            paths: [...folderPaths].sort(
              (a, b) =>
                Number(a.groupId != null) - Number(b.groupId != null) ||
                byName(a.groupName ?? "", b.groupName ?? ""),
            ),
            itemCount: countIn(folder.id),
          };
        });
      return { member, everyItem: null, folders: reached };
    });

  const everyItemPeople = members.filter((m) => m.everyItem).map((m) => m.member);
  const folderReviews: FolderReview[] = folders.map((folder) => ({
    folder,
    itemCount: countIn(folder.id),
    everyItemPeople,
    people: members.flatMap((m) =>
      m.folders
        .filter((f) => f.folder.id === folder.id)
        .map((f) => ({ member: m.member, flags: f.flags, level: f.level, paths: f.paths })),
    ),
  }));

  return {
    members,
    folders: folderReviews,
    itemCount: input.items.filter((i) => !i.deleted).length,
    itemsByFolder: counts,
  };
}

/** How many shared folders someone opens, and how many items are in them (each counted once). */
export function reachOf(
  access: MemberAccess,
  review: AccessReview,
): { folders: number; items: number } {
  if (access.everyItem) {
    return { folders: review.folders.length, items: review.itemCount };
  }
  const items = new Set<string>();
  for (const f of access.folders) {
    for (const id of review.itemsByFolder.get(f.folder.id) ?? []) {
      items.add(id);
    }
  }
  return { folders: access.folders.length, items: items.size };
}

/** A login someone could see the password of, and the shared folders they saw it through. */
export type SeenPassword = {
  item: AccessItemInput;
  /** Empty for an item in no shared folder, which only people who see every item reach. */
  folders: AccessFolderInput[];
};

/**
 * The logins whose passwords someone could see, to change when they leave:
 * in a shared folder they open where passwords aren't hidden from them
 * (directly or through a group), or every login for people who see every
 * item. A login only in folders where passwords are hidden from them is left
 * out. Items in the trash are left out.
 */
export function passwordsSeenBy(
  access: MemberAccess,
  items: AccessItemInput[],
  allFolders: AccessFolderInput[],
): SeenPassword[] {
  const logins = items.filter((i) => i.type === CipherType.Login && !i.deleted);
  let seen: SeenPassword[];
  if (access.everyItem) {
    const folderById = new Map(allFolders.map((f) => [f.id, f]));
    seen = logins.map((item) => ({
      item,
      folders: (item.collectionIds ?? [])
        .map((id) => folderById.get(id))
        .filter((f): f is AccessFolderInput => f != null),
    }));
  } else {
    const visible = access.folders.filter((f) => !f.flags.hidePasswords).map((f) => f.folder);
    seen = logins
      .map((item) => ({
        item,
        folders: visible.filter((f) => (item.collectionIds ?? []).includes(f.id)),
      }))
      .filter((s) => s.folders.length > 0);
  }
  for (const s of seen) {
    s.folders.sort((a, b) => byName(a.name, b.name));
  }
  return seen.sort((a, b) => byName(a.item.name, b.item.name) || byName(a.item.id, b.item.id));
}

/**
 * The list to paste into a ticket or a spreadsheet: a header and one line per
 * login, with its name and shared folders, tab separated. Names and folders
 * only, never a username, password, or anything else in the item.
 */
export function passwordListText(
  seen: SeenPassword[],
  labels: { name: string; folders: string; noFolder: string },
): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  const lines = seen.map(
    (s) =>
      `${clean(s.item.name)}\t${
        s.folders.length > 0 ? s.folders.map((f) => clean(f.name)).join(", ") : labels.noFolder
      }`,
  );
  return [`${labels.name}\t${labels.folders}`, ...lines].join("\n") + "\n";
}

type Translate = (key: string, ...args: string[]) => string;

/** The message key for a permission, in plain words. */
export const LEVEL_KEYS: Record<AccessLevel, string> = {
  manage: "keykeeperCanManage",
  edit: "keykeeperCanEdit",
  view: "keykeeperCanView",
  viewHidden: "keykeeperCanViewHidden",
  custom: "keykeeperCustomPermissions",
};

/**
 * A Custom grant's capabilities in plain words, such as "See passwords,
 * Create items" (every one it has besides seeing the items), or undefined for
 * a preset, whose name says it all.
 */
export function capabilitiesText(flags: AccessFlags, t: Translate): string | undefined {
  if (levelOf(flags) !== "custom") {
    return undefined;
  }
  const grid = gridOf(flags);
  const caps = FOLDER_CAPABILITIES.filter(({ key }) => grid[key]).map(({ label }) => t(label));
  return caps.length === 0 ? t("keykeeperCapSeeItems") : caps.join(", ");
}

/**
 * A grant in plain words: the preset's name, or "Custom: See passwords,
 * Create items" with every capability it has besides seeing the items.
 */
export function levelText(flags: AccessFlags, t: Translate): string {
  const caps = capabilitiesText(flags, t);
  return caps == null ? t(LEVEL_KEYS[levelOf(flags)]) : `${t(LEVEL_KEYS.custom)}: ${caps}`;
}

/** "Directly", "Through Front office", or for a group the viewer can't list, "Through a group". */
export function pathText(path: AccessPath, t: Translate): string {
  if (path.groupId == null) {
    return t("keykeeperAccessDirectly");
  }
  return path.groupName
    ? t("keykeeperAccessThroughGroup", path.groupName)
    : t("keykeeperAccessThroughAGroup");
}

/**
 * How someone reaches a folder. One way: "Directly" or "Through Front
 * office". Several: each with its own permission, such as "Directly (Can
 * edit), Through Front office (Can view but not see passwords)".
 */
export function howText(paths: AccessPath[], t: Translate): string {
  if (paths.length === 1) {
    return pathText(paths[0], t);
  }
  return paths.map((p) => `${pathText(p, t)} (${levelText(p.flags, t)})`).join("; ");
}

/** "3 shared folders", "1 shared folder". */
export function folderCount(n: number, t: Translate): string {
  return n === 1 ? t("keykeeperOneSharedFolder") : t("keykeeperSharedFolderCount", String(n));
}

/** "42 items", "1 item". */
export function itemCount(n: number, t: Translate): string {
  return n === 1 ? t("keykeeperOneItem") : t("keykeeperItemCount", String(n));
}

/**
 * One sentence for the remove and revoke confirmations: what the person can
 * open, so whoever removes them knows what's at stake before they do.
 */
export function reachSentence(
  name: string,
  access: MemberAccess,
  review: AccessReview,
  t: Translate,
): string {
  const status = access.member.status;
  if (status === "pending") {
    return t("keykeeperReachNeverConfirmed", name);
  }
  const reach = reachOf(access, review);
  const items = itemCount(reach.items, t);
  const revoked = status === "revoked";
  if (access.everyItem) {
    return t(revoked ? "keykeeperReachEveryItemRevoked" : "keykeeperReachEveryItem", name, items);
  }
  if (reach.folders === 0) {
    return t(revoked ? "keykeeperReachNoFoldersRevoked" : "keykeeperReachNoFolders", name);
  }
  return t(
    revoked ? "keykeeperReachFoldersRevoked" : "keykeeperReachFolders",
    name,
    folderCount(reach.folders, t),
    items,
  );
}

const contains = (text: string | null | undefined, query: string) =>
  (text ?? "").toLocaleLowerCase().includes(query);

/** For the Access page's search: a person matches by name or email, or by a folder or group they reach. */
export function memberMatches(access: MemberAccess, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") {
    return true;
  }
  const m = access.member;
  return (
    contains(m.name, q) ||
    contains(m.email, q) ||
    access.folders.some(
      (f) => contains(f.folder.name, q) || f.paths.some((p) => contains(p.groupName, q)),
    )
  );
}

/** A shared folder matches by its name, or by a person or group that reaches it. */
export function folderMatches(folder: FolderReview, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") {
    return true;
  }
  return (
    contains(folder.folder.name, q) ||
    folder.people.some(
      (p) =>
        contains(p.member.name, q) ||
        contains(p.member.email, q) ||
        p.paths.some((path) => contains(path.groupName, q)),
    )
  );
}
