// Keykeeper: every place an item lives, grouped by who owns it, like a drive
// (DESIGN.md, "Folders and permissions"): Personal with the person's own
// folders under it, then each organization with its shared folders under it.
// The web vault's menu shows them so; the extension's folder filter and its
// item editor's Folder picker use this for the same order and nesting.

/** Folders nest by name: "Work/Clients" is Clients inside Work. */
export const FOLDER_NESTING = "/";

export type OwnerPlaceKind = "personal" | "folder" | "organization" | "sharedFolder";

/** One entry: an owner (depth 0) or a folder under it. */
export type OwnerPlace = {
  /** Stable, for tracking: "personal", "folder:<id or none>", "org:<id>", "shared:<id>". */
  key: string;
  kind: OwnerPlaceKind;
  label: string;
  /** 0 for an owner, 1 for its folders, and one more for each level of nesting. */
  depth: number;
  /** The organization, for an organization and its shared folders. */
  organizationId?: string;
  /** A personal folder's id; null for "No folder". */
  folderId?: string | null;
  /** A shared folder's id. */
  collectionId?: string;
};

export type OwnerPlacesInput = {
  personalLabel: string;
  noFolderLabel: string;
  /** The person's own folders, without upstream's "no folder" entry. */
  folders: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  /** Shared folders, each in its organization. */
  collections: { id: string; name: string; organizationId: string }[];
  /** Sorts names as the apps do (I18nService's collator). */
  compare?: (a: string, b: string) => number;
};

const byName =
  (compare: (a: string, b: string) => number) =>
  <T extends { name: string }>(a: T, b: T) =>
    compare(a.name ?? "", b.name ?? "");

/**
 * Names nested under their parents: each name's last part as its label, one
 * level in from a parent that's in the list too; a name whose parent isn't
 * there keeps its whole name at the top.
 */
function nested<T extends { name: string }>(
  items: T[],
  baseDepth: number,
): { item: T; label: string; depth: number }[] {
  const names = new Set(items.map((i) => i.name));
  const depthOf = (name: string): number => {
    const cut = name.lastIndexOf(FOLDER_NESTING);
    if (cut <= 0) {
      return 0;
    }
    const parent = name.slice(0, cut);
    return names.has(parent) ? depthOf(parent) + 1 : 0;
  };
  return items.map((item) => {
    const depth = depthOf(item.name);
    const label =
      depth > 0 ? item.name.slice(item.name.lastIndexOf(FOLDER_NESTING) + 1) : item.name;
    return { item, label, depth: baseDepth + depth };
  });
}

/**
 * Personal, its folders (sorted, nested, then "No folder" when there are
 * real folders), then each organization by name with its shared folders.
 * An organization the person reaches no shared folder of still shows, since
 * its items (an admin's) can be anywhere in it.
 */
export function ownerPlaces(input: OwnerPlacesInput): OwnerPlace[] {
  const compare = input.compare ?? ((a, b) => a.localeCompare(b));
  const sort = byName(compare);
  const places: OwnerPlace[] = [
    { key: "personal", kind: "personal", label: input.personalLabel, depth: 0 },
  ];

  const folders = input.folders.filter((f) => f.id).sort(sort);
  for (const { item, label, depth } of nested(folders, 1)) {
    places.push({ key: `folder:${item.id}`, kind: "folder", label, depth, folderId: item.id });
  }
  if (folders.length > 0) {
    places.push({
      key: "folder:none",
      kind: "folder",
      label: input.noFolderLabel,
      depth: 1,
      folderId: null,
    });
  }

  for (const org of [...input.organizations].sort(sort)) {
    places.push({
      key: `org:${org.id}`,
      kind: "organization",
      label: org.name,
      depth: 0,
      organizationId: org.id,
    });
    const shared = input.collections.filter((c) => c.organizationId === org.id).sort(sort);
    for (const { item, label, depth } of nested(shared, 1)) {
      places.push({
        key: `shared:${item.id}`,
        kind: "sharedFolder",
        label,
        depth,
        organizationId: org.id,
        collectionId: item.id,
      });
    }
  }
  return places;
}
