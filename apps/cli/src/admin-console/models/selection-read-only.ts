import {
  FolderGrid,
  upstreamOf,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { SelectionReadOnlyRequest } from "@bitwarden/common/admin-console/models/request/selection-read-only.request";

export class SelectionReadOnly {
  static template(): SelectionReadOnly {
    return new SelectionReadOnly("00000000-0000-0000-0000-000000000000", false, false, false);
  }

  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  /**
   * Keykeeper: the grant's grid of permissions in the shared folder, which
   * decides it on our server; the three fields above are its closest preset.
   * See DESIGN.md, "Folders and permissions".
   */
  keykeeper?: FolderGrid;

  constructor(
    id: string,
    readOnly: boolean,
    hidePasswords: boolean,
    manage: boolean,
    keykeeper?: FolderGrid,
  ) {
    this.id = id;
    this.readOnly = readOnly;
    this.hidePasswords = hidePasswords || false;
    this.manage = manage;
    if (keykeeper != null) {
      this.keykeeper = keykeeper;
    }
  }
}

/**
 * Keykeeper: a grant from a CLI request, for the server, with its grid when it
 * has one, so saving a folder keeps everyone's permissions. A grid that
 * disagrees with readOnly, hidePasswords, or manage is refused: sent without
 * it, the server would keep the stored grid while those fields are unchanged,
 * so an edited grid would be dropped without a word. A grant without a grid
 * gets the preset its fields name.
 */
export function selectionRequest(selection: SelectionReadOnly): SelectionReadOnlyRequest {
  const grid = selection.keykeeper ?? undefined;
  if (grid != null) {
    const upstream = upstreamOf(grid);
    if (
      upstream.readOnly !== !!selection.readOnly ||
      upstream.hidePasswords !== !!selection.hidePasswords ||
      upstream.manage !== !!selection.manage
    ) {
      throw new Error(
        `The grant for ${selection.id} has a keykeeper grid that doesn't match its readOnly, ` +
          `hidePasswords, and manage: make readOnly/hidePasswords/manage match the grid ` +
          `(readOnly ${upstream.readOnly}, hidePasswords ${upstream.hidePasswords}, ` +
          `manage ${upstream.manage}), or remove keykeeper to use the preset.`,
      );
    }
  }
  return new SelectionReadOnlyRequest(
    selection.id,
    selection.readOnly,
    selection.hidePasswords,
    selection.manage,
    grid,
  );
}
