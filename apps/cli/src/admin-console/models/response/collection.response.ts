import { FolderGrid, gridOf } from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { CollectionWithIdExport } from "@bitwarden/common/models/export/collection-with-id.export";

import { BaseResponse } from "../../../models/response/base.response";

export class CollectionResponse extends CollectionWithIdExport implements BaseResponse {
  object: string;
  /**
   * Keykeeper: what the person can do in this shared folder (DESIGN.md,
   * "Folders and permissions"), such as whether they can see its passwords.
   */
  permissions: FolderGrid;

  constructor(o: CollectionView) {
    super();
    this.object = "collection";
    this.build(o);
    this.permissions = gridOf(o);
  }
}
