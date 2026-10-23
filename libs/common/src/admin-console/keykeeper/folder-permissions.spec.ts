import {
  FOLDER_PRESETS,
  FolderGrid,
  GRID_ALL,
  GRID_NONE,
  gridOf,
  gridProblem,
  gridWithin,
  itemGrid,
  mergeGrids,
  presetGrid,
  presetOf,
  toggleCapability,
  upstreamOf,
} from "./folder-permissions";

// The server's copy of these rules (passbundle-server,
// keykeeper_folder_permissions.rs) has the same cases in its unit tests.

describe("presets", () => {
  it("are what upstream's fields name", () => {
    expect(presetGrid({ readOnly: true, hidePasswords: false, manage: false })).toEqual(
      FOLDER_PRESETS.view,
    );
    expect(presetGrid({ readOnly: true, hidePasswords: true, manage: false })).toEqual(
      FOLDER_PRESETS.viewHidden,
    );
    expect(presetGrid({ readOnly: false, hidePasswords: false, manage: false })).toEqual(
      FOLDER_PRESETS.edit,
    );
    // Manage is everything, whatever else the fields say.
    expect(presetGrid({ readOnly: true, hidePasswords: true, manage: true })).toEqual(GRID_ALL);
  });

  it("keep upstream's Can edit except passwords without what needs see passwords", () => {
    expect(presetGrid({ readOnly: false, hidePasswords: true, manage: false })).toEqual({
      ...GRID_NONE,
      create: true,
      edit: true,
      delete: true,
      viewHistory: true,
    });
  });

  it("give export only to Can manage", () => {
    expect(FOLDER_PRESETS.view.export).toBe(false);
    expect(FOLDER_PRESETS.edit.export).toBe(false);
    expect(FOLDER_PRESETS.manage.export).toBe(true);
  });

  it("each follow the grid's rules, and round-trip upstream's fields", () => {
    for (const preset of Object.values(FOLDER_PRESETS)) {
      expect(gridProblem(preset)).toBeUndefined();
      expect(presetGrid(upstreamOf(preset))).toEqual(preset);
    }
  });

  it("name each grid, or Custom", () => {
    expect(presetOf(FOLDER_PRESETS.edit)).toBe("edit");
    expect(presetOf({ ...FOLDER_PRESETS.edit, export: true })).toBe("custom");
    expect(presetOf(GRID_NONE)).toBe("custom");
  });
});

describe("upstreamOf", () => {
  it("gives upstream clients the closest preset: edit and see passwords decide", () => {
    expect(upstreamOf({ ...GRID_NONE, create: true })).toEqual({
      readOnly: true,
      hidePasswords: true,
      manage: false,
    });
    expect(upstreamOf({ ...GRID_NONE, seePasswords: true, edit: true })).toEqual({
      readOnly: false,
      hidePasswords: false,
      manage: false,
    });
    expect(upstreamOf(GRID_ALL)).toEqual({ readOnly: false, hidePasswords: false, manage: true });
  });
});

describe("gridOf", () => {
  it("is the server's grid when it sent one, otherwise the preset of upstream's fields", () => {
    const custom: FolderGrid = { ...GRID_NONE, create: true };
    expect(gridOf({ readOnly: true, hidePasswords: true, manage: false, keykeeper: custom })).toEqual(
      custom,
    );
    expect(gridOf({ readOnly: false, hidePasswords: false, manage: false })).toEqual(
      FOLDER_PRESETS.edit,
    );
  });
});

describe("mergeGrids", () => {
  it("gives the most open way for each capability", () => {
    const dropBox = { ...GRID_NONE, create: true };
    const viewer = FOLDER_PRESETS.view;
    expect(mergeGrids([dropBox, viewer])).toEqual({ ...viewer, create: true });
  });

  it("hides passwords only while every way hides them, as the Access page and the server do", () => {
    expect(mergeGrids([FOLDER_PRESETS.viewHidden, FOLDER_PRESETS.viewHidden])!.seePasswords).toBe(
      false,
    );
    expect(mergeGrids([FOLDER_PRESETS.viewHidden, FOLDER_PRESETS.view])!.seePasswords).toBe(true);
  });

  it("has nothing to merge without a way in", () => {
    expect(mergeGrids([])).toBeUndefined();
  });
});

describe("gridProblem", () => {
  it("refuses export, print, or share without see passwords, and manage without everything", () => {
    expect(gridProblem({ ...GRID_NONE, export: true })).toBe("keykeeperGridNeedsSeePasswords");
    expect(gridProblem({ ...GRID_NONE, print: true })).toBe("keykeeperGridNeedsSeePasswords");
    expect(gridProblem({ ...GRID_NONE, share: true })).toBe("keykeeperGridNeedsSeePasswords");
    expect(gridProblem({ ...GRID_NONE, manage: true })).toBe("keykeeperGridManageIncludesAll");
    expect(gridProblem({ ...GRID_ALL, delete: false })).toBe("keykeeperGridManageIncludesAll");
    // Create, edit, and delete are independent.
    expect(gridProblem({ ...GRID_NONE, create: true })).toBeUndefined();
    expect(gridProblem({ ...GRID_NONE, edit: true })).toBeUndefined();
  });
});

describe("toggleCapability", () => {
  it("keeps the grid within its rules as boxes are checked", () => {
    const exporting = toggleCapability(GRID_NONE, "export", true);
    expect(exporting.seePasswords).toBe(true);
    expect(gridProblem(exporting)).toBeUndefined();

    const blind = toggleCapability(
      { ...FOLDER_PRESETS.view, share: true, export: true },
      "seePasswords",
      false,
    );
    expect(blind).toEqual({ ...GRID_NONE, viewHistory: true });

    expect(toggleCapability(GRID_NONE, "manage", true)).toEqual(GRID_ALL);
    const lessThanManage = toggleCapability(GRID_ALL, "delete", false);
    expect(lessThanManage.manage).toBe(false);
    expect(lessThanManage.delete).toBe(false);
    expect(gridProblem(lessThanManage)).toBeUndefined();
  });
});

describe("gridWithin", () => {
  it("is true when every capability is also in the other", () => {
    expect(gridWithin(FOLDER_PRESETS.view, FOLDER_PRESETS.edit)).toBe(true);
    expect(gridWithin(FOLDER_PRESETS.edit, FOLDER_PRESETS.view)).toBe(false);
    expect(gridWithin(GRID_NONE, GRID_NONE)).toBe(true);
  });
});

describe("itemGrid", () => {
  const folder = (id: string, keykeeper: FolderGrid) => ({
    id,
    organizationId: "org",
    readOnly: true,
    hidePasswords: true,
    manage: false,
    keykeeper,
  });

  it("is everything for one's own item", () => {
    expect(itemGrid({ organizationId: null }, [])).toEqual(GRID_ALL);
  });

  it("is what any of the item's folders allows", () => {
    const folders = [
      folder("a", FOLDER_PRESETS.viewHidden),
      folder("b", { ...GRID_NONE, seePasswords: true, delete: true }),
      folder("c", GRID_ALL),
    ];
    expect(itemGrid({ organizationId: "org", collectionIds: ["a", "b"] }, folders)).toEqual({
      ...GRID_NONE,
      seePasswords: true,
      delete: true,
      viewHistory: true,
    });
  });

  it("falls back for an item in no folder the person reaches", () => {
    expect(itemGrid({ organizationId: "org", collectionIds: ["x"] }, [])).toEqual(GRID_NONE);
    expect(itemGrid({ organizationId: "org", collectionIds: [] }, [], GRID_ALL)).toEqual(GRID_ALL);
  });
});
