import { BaseResponse } from "../../../models/response/base.response";
import { FolderGrid } from "../../keykeeper/folder-permissions";

export class SelectionReadOnlyResponse extends BaseResponse {
  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  /** Keykeeper: the grant's grid, from our server. */
  keykeeper?: FolderGrid;

  constructor(response: any) {
    super(response);
    this.id = this.getResponseProperty("Id");
    this.readOnly = this.getResponseProperty("ReadOnly");
    this.hidePasswords = this.getResponseProperty("HidePasswords");
    this.manage = this.getResponseProperty("Manage");
    this.keykeeper = this.getResponseProperty("Keykeeper") ?? undefined;
  }
}
