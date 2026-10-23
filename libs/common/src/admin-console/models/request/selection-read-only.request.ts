import { FolderGrid } from "../../keykeeper/folder-permissions";

export class SelectionReadOnlyRequest {
  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  /**
   * Keykeeper: the grant's grid of capabilities, which decides it on our
   * server; upstream's three fields carry its closest preset. See DESIGN.md,
   * "Folders and permissions".
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
    this.hidePasswords = hidePasswords;
    this.manage = manage;
    if (keykeeper != null) {
      this.keykeeper = keykeeper;
    }
  }
}
