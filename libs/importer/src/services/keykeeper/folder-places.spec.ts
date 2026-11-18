import {
  CollectionTypes,
  CollectionView,
} from "@bitwarden/common/admin-console/models/collections";
import { CollectionId, OrganizationId } from "@bitwarden/common/types/guid";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { ImportResult } from "../../models/import-result";

import {
  applyFolderPlan,
  askFolderPlan,
  FolderPlace,
  FolderPlan,
  folderQuestion,
  ImportCanceled,
} from "./folder-places";

const org = "11111111-1111-4111-8111-111111111111" as OrganizationId;

function collection(name: string, id?: string): CollectionView {
  return new CollectionView({ id: id as CollectionId, organizationId: org, name });
}

function item(name: string): CipherView {
  const c = new CipherView();
  c.name = name;
  return c;
}

/**
 * A file as an importer reads it into an organization: its folders, and its
 * items with the folders each is in (by name).
 */
function file(folders: string[], items: [string, string[]][]): ImportResult {
  const result = new ImportResult();
  result.success = true;
  result.collections = folders.map((f) => collection(f));
  items.forEach(([name, inFolders], i) => {
    result.ciphers.push(item(name));
    for (const f of inFolders) {
      result.collectionRelationships.push([i, folders.indexOf(f)]);
    }
  });
  return result;
}

/** Each item's shared folders by name, after the plan. */
function placedNames(result: ImportResult): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  result.ciphers.forEach((c, i) => {
    out[c.name] = result.collectionRelationships
      .filter(([item]) => item === i)
      .map(([, f]) => result.collections[f].name);
  });
  return out;
}

const NEW: FolderPlace = { kind: "new" };
const LEAVE: FolderPlace = { kind: "leave" };
const existing = (c: CollectionView): FolderPlace => ({ kind: "existing", collection: c });

describe("folderQuestion", () => {
  it("lists each folder with its own items, a parent right before its subfolders", () => {
    const result = file(
      ["Network/Firewall", "Admin", "Network", "Network/VPN", "admin/Old"],
      [
        ["Router", ["Network/Firewall"]],
        ["Switch", ["Network"]],
        ["Domain", ["Admin"]],
        ["Tunnel", ["Network/VPN"]],
        ["Also in two", ["Network/VPN", "Admin"]],
        ["No folder", []],
      ],
    );

    const q = folderQuestion(result);

    expect(q.folders.map((f) => [f.name, f.label, f.depth, f.items, f.subfolders])).toEqual([
      ["Admin", "Admin", 0, 2, 0],
      // No folder named "admin" in the file, so it's at the top, with its whole name.
      ["admin/Old", "admin/Old", 0, 0, 0],
      ["Network", "Network", 0, 1, 2],
      ["Network/Firewall", "Firewall", 1, 1, 0],
      ["Network/VPN", "VPN", 1, 2, 0],
    ]);
    expect(q.folders.map((f) => f.index)).toEqual([1, 4, 2, 0, 3]);
    expect(q.itemFolders).toEqual([[0], [2], [1], [3], [3, 1], []]);
  });

  it("nests under the nearest parent the file has, and keeps a folder's id from the file", () => {
    const result = file(["A", "A/B/C", "A/B/C/D"], [["x", ["A/B/C/D"]]]);
    result.collections[1].id = "22222222-2222-4222-8222-222222222222" as CollectionId;

    const q = folderQuestion(result);

    expect(q.folders.map((f) => [f.label, f.depth, f.subfolders, f.id])).toEqual([
      ["A", 0, 2, undefined],
      ["B/C", 1, 1, "22222222-2222-4222-8222-222222222222"],
      ["D", 2, 0, undefined],
    ]);
  });
});

describe("applyFolderPlan", () => {
  const plan = (result: ImportResult, places: FolderPlace[]): FolderPlan => ({
    places,
    names: result.collections.map((c) => c.name),
  });

  it("by default, makes each folder a new shared folder, as upstream does", () => {
    const result = file(
      ["Network", "Network/Firewall"],
      [
        ["Router", ["Network/Firewall"]],
        ["Switch", ["Network"]],
      ],
    );
    result.collections[0].id = "33333333-3333-4333-8333-333333333333" as CollectionId;

    applyFolderPlan(result, plan(result, [NEW, NEW]));

    expect(result.collections.map((c) => c.name)).toEqual(["Network", "Network/Firewall"]);
    // Always made new, even when the file names one of the organization's by id.
    expect(result.collections.map((c) => c.id)).toEqual([undefined, undefined]);
    expect(placedNames(result)).toEqual({
      Router: ["Network/Firewall"],
      Switch: ["Network"],
    });
    expect(result.existingCollections).toBe(0);
    expect(result.placed).toEqual([
      "Put 1 item in Network, a new shared folder.",
      "Put 1 item in Network/Firewall, a new shared folder.",
    ]);
    expect(result.leftOut).toEqual([]);
  });

  it("puts a folder's items into a shared folder already here, once even when two go there", () => {
    const clients = collection("Clients", "44444444-4444-4444-8444-444444444444");
    const result = file(
      ["Acme", "Beta", "Gamma"],
      [
        ["One", ["Acme"]],
        ["Two", ["Beta"]],
        ["Three", ["Acme", "Beta"]],
        ["Four", ["Gamma"]],
      ],
    );

    applyFolderPlan(result, plan(result, [existing(clients), existing(clients), NEW]));

    expect(result.collections).toEqual([clients, expect.objectContaining({ name: "Gamma" })]);
    expect(placedNames(result)).toEqual({
      One: ["Clients"],
      Two: ["Clients"],
      Three: ["Clients"],
      Four: ["Gamma"],
    });
    expect(result.existingCollections).toBe(1);
    expect(result.placed).toEqual([
      "Put 3 items in Clients.",
      "Put 1 item in Gamma, a new shared folder.",
    ]);
  });

  it("leaves out a folder's items, but not one that's also in a folder that comes in", () => {
    const result = file(
      ["Old", "Keep", "Archive"],
      [
        ["Gone", ["Old"]],
        ["Stays", ["Keep"]],
        ["In both", ["Old", "Keep"]],
        ["Also gone", ["Archive", "Old"]],
        ["No folder", []],
      ],
    );
    result.folderRelationships = [
      [1, 0],
      [4, 0],
    ];

    applyFolderPlan(result, plan(result, [LEAVE, NEW, LEAVE]));

    expect(result.ciphers.map((c) => c.name)).toEqual(["Stays", "In both", "No folder"]);
    expect(result.collections.map((c) => c.name)).toEqual(["Keep"]);
    expect(result.collectionRelationships).toEqual([
      [0, 0],
      [1, 0],
    ]);
    // Item numbers follow the items that stay.
    expect(result.folderRelationships).toEqual([
      [0, 0],
      [2, 0],
    ]);
    expect(result.placed).toEqual([
      "Put 2 items in Keep, a new shared folder.",
      "1 item with no folder isn't in a shared folder.",
    ]);
    expect(result.leftOut).toEqual(["Left out 2 items in Old and Archive."]);
  });

  it("adds to what the importer already left out, and names three folders in a list", () => {
    const result = file(
      ["A", "B", "C", "D"],
      [
        ["a", ["A"]],
        ["b", ["B"]],
        ["c", ["C"]],
        ["d", ["D"]],
      ],
    );
    result.leftOut = ["Left out 1 password for other clients."];

    applyFolderPlan(result, plan(result, [LEAVE, LEAVE, LEAVE, NEW]));

    expect(result.leftOut).toEqual([
      "Left out 1 password for other clients.",
      "Left out 3 items in A, B, and C.",
    ]);
  });

  it("doesn't move a parent's subfolders with it", () => {
    const clients = collection("Clients", "55555555-5555-4555-8555-555555555555");
    const result = file(
      ["Network", "Network/Firewall", "Network/VPN"],
      [
        ["Switch", ["Network"]],
        ["Router", ["Network/Firewall"]],
        ["Tunnel", ["Network/VPN"]],
      ],
    );

    applyFolderPlan(result, plan(result, [existing(clients), NEW, LEAVE]));

    expect(placedNames(result)).toEqual({
      Switch: ["Clients"],
      Router: ["Network/Firewall"],
    });
    expect(result.leftOut).toEqual(["Left out 1 item in Network/VPN."]);
  });

  it("keeps the import's shared folder first, for items with no folder, with new ones inside it", () => {
    const target = collection("Imports", "66666666-6666-4666-8666-666666666666");
    const acme = collection("Acme", "77777777-7777-4777-8777-777777777777");
    const result = file(
      ["Network", "Clients", "Old"],
      [
        ["Router", ["Network"]],
        ["Client", ["Clients"]],
        ["Gone", ["Old"]],
        ["Loose", []],
        ["Another client", ["Clients"]],
      ],
    );
    const names = result.collections.map((c) => c.name);
    // What upstream's setImportTarget does first.
    result.collections = [
      target,
      ...result.collections.map((c) => collection(`Imports/${c.name}`, c.id)),
    ];
    result.targetCollectionIncluded = true;
    result.collectionRelationships = [
      [3, 0],
      ...result.collectionRelationships.map(([i, f]): [number, number] => [i, f + 1]),
    ];

    applyFolderPlan(result, {
      places: [NEW, existing(acme), LEAVE],
      names,
    });

    expect(result.collections.map((c) => c.name)).toEqual(["Imports", "Imports/Network", "Acme"]);
    expect(placedNames(result)).toEqual({
      Router: ["Imports/Network"],
      Client: ["Acme"],
      Loose: ["Imports"],
      "Another client": ["Acme"],
    });
    expect(result.existingCollections).toBe(1);
    expect(result.placed).toEqual([
      "Put 1 item in Imports.",
      "Put 1 item in Imports/Network, a new shared folder.",
      "Put 2 items in Acme.",
    ]);
    expect(result.leftOut).toEqual(["Left out 1 item in Old."]);
  });

  it("uses the import's own shared folder once when a folder goes there too", () => {
    const target = collection("Imports", "88888888-8888-4888-8888-888888888888");
    const result = file(["Network"], [["Router", ["Network"]]]);
    result.collections = [target, collection("Imports/Network")];
    result.targetCollectionIncluded = true;
    result.collectionRelationships = [[0, 1]];

    applyFolderPlan(result, { places: [existing(target)], names: ["Network"] });

    expect(result.collections).toEqual([target]);
    expect(result.collectionRelationships).toEqual([[0, 0]]);
    expect(result.existingCollections).toBe(0);
  });

  it("refuses a plan that doesn't fit the file's folders", () => {
    const result = file(["A", "B"], [["a", ["A"]]]);
    expect(() => applyFolderPlan(result, { places: [NEW], names: ["A"] })).toThrow();
  });
});

describe("askFolderPlan", () => {
  const withFolders = () => file(["Network"], [["Router", ["Network"]]]);

  it("asks about the file's folders when importing into an organization", async () => {
    const placer = jest.fn().mockResolvedValue([NEW]);

    const plan = await askFolderPlan(withFolders(), org, null, placer);

    expect(placer).toHaveBeenCalledWith({
      folders: [{ index: 0, name: "Network", label: "Network", depth: 0, items: 1, subfolders: 0 }],
      itemFolders: [[0]],
    });
    expect(plan).toEqual({ places: [NEW], names: ["Network"] });
  });

  it("doesn't ask for Personal, someone's My Items, or a file with no folders", async () => {
    const placer = jest.fn().mockResolvedValue([NEW]);
    const myItems = collection("My Items", "99999999-9999-4999-8999-999999999999");
    myItems.type = CollectionTypes.DefaultUserCollection;

    expect(await askFolderPlan(withFolders(), null, new FolderView(), placer)).toBeNull();
    expect(await askFolderPlan(withFolders(), org, myItems, placer)).toBeNull();
    expect(await askFolderPlan(file([], [["x", []]]), org, null, placer)).toBeNull();
    expect(await askFolderPlan(withFolders(), org, null, undefined)).toBeNull();
    expect(placer).not.toHaveBeenCalled();
  });

  it("cancels the import when the question is closed", async () => {
    await expect(
      askFolderPlan(withFolders(), org, null, jest.fn().mockResolvedValue(null)),
    ).rejects.toBeInstanceOf(ImportCanceled);
  });

  it("refuses an answer that misses a folder", async () => {
    await expect(
      askFolderPlan(withFolders(), org, null, jest.fn().mockResolvedValue([])),
    ).rejects.toThrow("Choose where each folder goes.");
  });
});
