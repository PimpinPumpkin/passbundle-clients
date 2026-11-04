// Keykeeper: each shared folder says what the person may do there (DESIGN.md,
// "Folders and permissions").
import {
  FOLDER_PRESETS,
  GRID_ALL,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { CollectionView } from "@bitwarden/common/admin-console/models/collections";

import { CollectionResponse } from "./collection.response";

function folder(fields: Partial<CollectionView>) {
  return Object.assign(
    new CollectionView({ id: "c1", organizationId: "o1", name: "Servers" } as any),
    fields,
  );
}

describe("CollectionResponse", () => {
  it("gives the person's permissions in the folder from its grid", () => {
    const custom = { ...FOLDER_PRESETS.viewHidden, create: true };
    const res = new CollectionResponse(
      folder({ readOnly: true, hidePasswords: true, keykeeper: custom }),
    );
    expect(res.permissions).toEqual(custom);
    expect(res.permissions.seePasswords).toBe(false);
  });

  it("gives the preset upstream's fields name when there's no grid", () => {
    expect(
      new CollectionResponse(folder({ readOnly: true, hidePasswords: true })).permissions,
    ).toEqual(FOLDER_PRESETS.viewHidden);
    expect(new CollectionResponse(folder({ manage: true })).permissions).toEqual(GRID_ALL);
  });
});
