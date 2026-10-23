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
 * Keykeeper: a grant from a CLI request, for the server. Its grid goes back
 * with it while the grid still agrees with readOnly, hidePasswords, and
 * manage, so saving a folder keeps everyone's permissions. A grant whose
 * fields were edited without its grid goes without it, and the server gives
 * the preset those fields name.
 */
export function selectionRequest(selection: SelectionReadOnly): SelectionReadOnlyRequest {
  const grid = selection.keykeeper;
  const agrees =
    grid != null &&
    (() => {
      const upstream = upstreamOf(grid);
      return (
        upstream.readOnly === !!selection.readOnly &&
        upstream.hidePasswords === !!selection.hidePasswords &&
        upstream.manage === !!selection.manage
      );
    })();
  return new SelectionReadOnlyRequest(
    selection.id,
    selection.readOnly,
    selection.hidePasswords,
    selection.manage,
    agrees ? grid : undefined,
  );
}
