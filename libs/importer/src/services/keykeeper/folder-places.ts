// Keykeeper: an import into an organization says where each of the file's
// folders goes before anything is saved: a new shared folder with its name
// (upstream's way, still the default), a shared folder the organization
// already has and the person can add items to, or left out. Items with no
// folder go where the import's "into a shared folder" choice says, as
// upstream does. This changes only which shared folder each item names, not
// how items are encrypted or sent. The question is
// components/keykeeper/folder-places-dialog.component.ts. DESIGN.md,
// "Importing from other password managers".

import {
  CollectionTypes,
  CollectionView,
} from "@bitwarden/common/admin-console/models/collections";
import { CollectionId } from "@bitwarden/common/types/guid";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { ImportResult } from "../../models/import-result";

/** Where one of the file's folders goes. */
export type FolderPlace =
  { kind: "new" } | { kind: "existing"; collection: CollectionView } | { kind: "leave" };

/** One of the file's folders, as the question lists it. */
export type SourceFolder = {
  /** Its place in the file's folders (`ImportResult.collections`). */
  index: number;
  /** Its whole name as the file has it, with "/" between a folder and its subfolders. */
  name: string;
  /** What its row shows: its name under the nearest of its parents listed above it. */
  label: string;
  /** How many of its parents are listed above it. */
  depth: number;
  /** How many items are in it, not counting its subfolders' items. */
  items: number;
  /** How many folders are listed under it. */
  subfolders: number;
  /** The file's id for it, when the file has one (an organization's own export). */
  id?: string;
};

/** What the question needs from the file. */
export type FolderQuestion = {
  /** Each folder, a parent right before its subfolders. */
  folders: SourceFolder[];
  /** For each item, the folders it's in (their `index`); none for an item with no folder. */
  itemFolders: number[][];
};

/** Asks where each folder goes: a place for each, by `index`, or null when the person closed the question. */
export type FolderPlacer = (question: FolderQuestion) => Promise<FolderPlace[] | null>;

/** The answer, with the file's names for its folders, for the summary. */
export type FolderPlan = { places: FolderPlace[]; names: string[] };

/** The person closed the question without choosing: nothing was imported. */
export class ImportCanceled extends Error {
  constructor() {
    super("The import was canceled.");
    this.name = "ImportCanceled";
  }
}

/** The file's folders, nested, with how many items each holds. */
export function folderQuestion(result: ImportResult): FolderQuestion {
  const names = result.collections.map((c) => c.name ?? "");
  const itemFolders: number[][] = result.ciphers.map((): number[] => []);
  for (const [item, folder] of result.collectionRelationships) {
    const folders = itemFolders[item];
    if (folders != null && folder >= 0 && folder < names.length && !folders.includes(folder)) {
      folders.push(folder);
    }
  }
  const counts = names.map(() => 0);
  for (const folders of itemFolders) {
    for (const folder of folders) {
      counts[folder]++;
    }
  }

  // By name, a part at a time, so each parent comes right before its subfolders.
  const parts = names.map((n) => n.split("/"));
  const order = names.map((_, i) => i).sort((a, b) => compareParts(parts[a], parts[b]) || a - b);
  const byName = new Map<string, number>();
  for (const i of order) {
    if (!byName.has(names[i])) {
      byName.set(names[i], i);
    }
  }

  const rows = new Map<number, SourceFolder>();
  const folders: SourceFolder[] = [];
  for (const i of order) {
    const parent = nearestParent(parts[i], byName);
    const above = parent == null ? undefined : rows.get(parent);
    const row: SourceFolder = {
      index: i,
      name: names[i],
      label: above == null ? names[i] : names[i].slice(above.name.length + 1),
      depth: above == null ? 0 : above.depth + 1,
      items: counts[i],
      subfolders: 0,
    };
    const id = result.collections[i].id;
    if (id) {
      row.id = id;
    }
    rows.set(i, row);
    folders.push(row);
    for (let p = parent; p != null; p = nearestParent(parts[p], byName)) {
      rows.get(p)!.subfolders++;
    }
  }
  return { folders, itemFolders };
}

/**
 * Into an organization (not someone's own My Items), when the file has
 * folders: asks where each goes. Null when there's nothing to ask.
 * Throws ImportCanceled when the person closed the question.
 */
export async function askFolderPlan(
  result: ImportResult,
  organizationId: string | null | undefined,
  target: FolderView | CollectionView | null | undefined,
  placer: FolderPlacer | null | undefined,
): Promise<FolderPlan | null> {
  if (placer == null || organizationId == null || result.collections.length === 0) {
    return null;
  }
  if (target instanceof CollectionView && target.type === CollectionTypes.DefaultUserCollection) {
    return null;
  }
  const names = result.collections.map((c) => c.name ?? "");
  const places = await placer(folderQuestion(result));
  if (places == null) {
    throw new ImportCanceled();
  }
  if (places.length !== names.length || places.some((p) => p == null)) {
    throw new Error("Choose where each folder goes.");
  }
  return { places, names };
}

/**
 * Puts the file's items where the plan says, once upstream has added the
 * import's "into a shared folder" choice (the first of `collections` when
 * `targetCollectionIncluded`) and named new folders inside it. A new folder
 * stays as upstream left it, without the file's id for it, so it's always
 * made new; an existing one takes its place; a left-out one goes, and so does
 * every item that was in no other folder. Writes what the summary says.
 */
export function applyFolderPlan(result: ImportResult, plan: FolderPlan): void {
  const offset = result.targetCollectionIncluded ? 1 : 0;
  const source = result.collections.slice(offset);
  if (source.length !== plan.places.length) {
    throw new Error("The import's folders changed after they were placed.");
  }

  const collections: CollectionView[] = result.collections.slice(0, offset);
  const at = new Map<string, number>();
  if (offset === 1 && collections[0].id) {
    at.set(collections[0].id, 0);
  }
  const made = new Set<number>();
  let existing = 0;
  const to = plan.places.map((place, i): number | null => {
    switch (place.kind) {
      case "leave":
        return null;
      case "new": {
        // Made new, even when the file names one of this organization's by id.
        (source[i] as { id?: CollectionId }).id = undefined;
        collections.push(source[i]);
        made.add(collections.length - 1);
        return collections.length - 1;
      }
      case "existing": {
        const id = place.collection.id;
        let index = at.get(id);
        if (index == null) {
          collections.push(place.collection);
          index = collections.length - 1;
          at.set(id, index);
          existing++;
        }
        return index;
      }
    }
  });

  const ciphers = result.ciphers;
  const placed: number[][] = ciphers.map((): number[] => []);
  const from: number[][] = ciphers.map((): number[] => []);
  for (const [item, folder] of result.collectionRelationships) {
    if (placed[item] == null || folder < 0 || folder >= offset + to.length) {
      continue;
    }
    const index = folder < offset ? folder : to[folder - offset];
    if (folder >= offset) {
      from[item].push(folder - offset);
    }
    if (index != null && !placed[item].includes(index)) {
      placed[item].push(index);
    }
  }

  // An item every one of whose folders is left out is left out with them.
  const keep = ciphers.map((_, i) => from[i].length === 0 || placed[i].length > 0);
  const renumbered: number[] = [];
  let next = 0;
  keep.forEach((k, i) => (renumbered[i] = k ? next++ : -1));

  const counts = collections.map(() => 0);
  let loose = 0;
  const leftFrom = new Set<number>();
  ciphers.forEach((_, i) => {
    if (!keep[i]) {
      from[i].forEach((f) => leftFrom.add(f));
      return;
    }
    placed[i].forEach((c) => counts[c]++);
    if (placed[i].length === 0) {
      loose++;
    }
  });
  const leftOut = keep.filter((k) => !k).length;

  result.ciphers = ciphers.filter((_, i) => keep[i]);
  result.collections = collections;
  result.collectionRelationships = placed.flatMap((cs, i) =>
    keep[i] ? cs.map((c): [number, number] => [renumbered[i], c]) : [],
  );
  result.folderRelationships = result.folderRelationships
    .filter(([item]) => keep[item])
    .map(([item, folder]) => [renumbered[item], folder]);
  result.existingCollections = existing;

  const lines: string[] = [];
  collections.forEach((c, i) => {
    if (counts[i] > 0) {
      lines.push(
        `Put ${items(counts[i])} in ${c.name}${made.has(i) ? ", a new shared folder" : ""}.`,
      );
    }
  });
  if (loose > 0) {
    lines.push(
      `${items(loose)} with no folder ${loose === 1 ? "isn't" : "aren't"} in a shared folder.`,
    );
  }
  result.placed = lines;
  if (leftOut > 0) {
    const names = [...leftFrom].sort((a, b) => a - b).map((f) => plan.names[f]);
    result.leftOut = [...(result.leftOut ?? []), `Left out ${items(leftOut)} in ${and(names)}.`];
  }
}

function items(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

/** "A", "A and B", "A, B, and C". */
function and(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function compareParts(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = a[i].localeCompare(b[i], "en", { sensitivity: "base" }) || compare(a[i], b[i]);
    if (c !== 0) {
      return c;
    }
  }
  return a.length - b.length;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The nearest of a folder's parents the file has, by its index. */
function nearestParent(parts: string[], byName: Map<string, number>): number | undefined {
  for (let n = parts.length - 1; n > 0; n--) {
    const parent = byName.get(parts.slice(0, n).join("/"));
    if (parent != null) {
      return parent;
    }
  }
  return undefined;
}
