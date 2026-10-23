// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { View } from "../../../models/view/view";
import { FolderGrid } from "../../keykeeper/folder-permissions";

interface SelectionResponseLike {
  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  keykeeper?: FolderGrid;
}

export class CollectionAccessSelectionView extends View {
  readonly id: string;
  readonly readOnly: boolean;
  readonly hidePasswords: boolean;
  readonly manage: boolean;
  /**
   * Keykeeper: the grant's grid of capabilities. Saved with the grant, it
   * decides it on our server (DESIGN.md, "Folders and permissions").
   */
  readonly keykeeper?: FolderGrid;

  constructor(response?: SelectionResponseLike) {
    super();

    if (!response) {
      return;
    }

    this.id = response.id;
    this.readOnly = response.readOnly;
    this.hidePasswords = response.hidePasswords;
    this.manage = response.manage;
    if (response.keykeeper != null) {
      this.keykeeper = response.keykeeper;
    }
  }
}
