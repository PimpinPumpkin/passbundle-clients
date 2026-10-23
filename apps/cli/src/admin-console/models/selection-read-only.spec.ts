import {
  FOLDER_PRESETS,
  FolderGrid,
  GRID_NONE,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";

import { SelectionReadOnly, selectionRequest } from "./selection-read-only";

// Keykeeper: see DESIGN.md, "Folders and permissions".
describe("selectionRequest", () => {
  const custom = { ...GRID_NONE, seePasswords: true, edit: true, viewHistory: true };

  it("sends the grid while it agrees with readOnly, hidePasswords, and manage", () => {
    const request = selectionRequest(new SelectionReadOnly("kept", false, false, false, custom));
    expect(request.keykeeper).toEqual(custom);
    expect([request.readOnly, request.hidePasswords, request.manage]).toEqual([
      false,
      false,
      false,
    ]);
    const manager = selectionRequest(
      new SelectionReadOnly("manager", false, false, true, { ...FOLDER_PRESETS.manage }),
    );
    expect(manager.keykeeper).toEqual(FOLDER_PRESETS.manage);
  });

  it("sends no grid for a grant without one, so the server gives the preset its fields name", () => {
    expect(selectionRequest(new SelectionReadOnly("plain", true, true, false)).keykeeper).toBe(
      undefined,
    );
    // As a request file can have it.
    const nulled = new SelectionReadOnly("nulled", true, false, false);
    nulled.keykeeper = null as unknown as FolderGrid;
    expect(selectionRequest(nulled).keykeeper).toBe(undefined);
  });

  it("refuses a narrowed grid sent with the fields it had before, instead of dropping it", () => {
    // Printed as Can edit, then the grid narrowed to Can view and the fields left.
    const narrowed = new SelectionReadOnly("narrowed", false, false, false, {
      ...FOLDER_PRESETS.view,
    });
    expect(() => selectionRequest(narrowed)).toThrow(
      "make readOnly/hidePasswords/manage match the grid (readOnly true, hidePasswords false, manage false), or remove keykeeper to use the preset",
    );
  });

  it.each([
    ["readOnly", new SelectionReadOnly("a", true, false, false, custom)],
    ["hidePasswords", new SelectionReadOnly("b", false, true, false, custom)],
    ["manage", new SelectionReadOnly("c", false, false, true, custom)],
  ])("refuses a grid that disagrees with %s", (_field, selection) => {
    expect(() => selectionRequest(selection)).toThrow(/doesn't match its readOnly/);
  });
});
