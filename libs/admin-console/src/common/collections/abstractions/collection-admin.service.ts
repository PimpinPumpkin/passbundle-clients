import { Observable } from "rxjs";

import {
  CollectionAdminView,
  CollectionAccessSelectionView,
  CollectionDetailsResponse,
} from "@bitwarden/common/admin-console/models/collections";
import { CollectionId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { FolderLook } from "@bitwarden/common/vault/keykeeper/folder-looks";

export abstract class CollectionAdminService {
  abstract collectionAdminViews$(
    organizationId: string,
    userId: UserId,
  ): Observable<CollectionAdminView[]>;
  abstract update(
    collection: CollectionAdminView,
    userId: UserId,
  ): Promise<CollectionDetailsResponse>;
  abstract create(
    collection: CollectionAdminView,
    userId: UserId,
  ): Promise<CollectionDetailsResponse>;
  abstract delete(organizationId: string, collectionId: string): Promise<void>;
  abstract bulkAssignAccess(
    organizationId: string,
    collectionIds: string[],
    users: CollectionAccessSelectionView[],
    groups: CollectionAccessSelectionView[],
  ): Promise<void>;
  /**
   * Keykeeper: sets a shared folder's icon and color, or with null gives it
   * back the plain glyph (DESIGN.md, "Folder icons"). Encrypted with the
   * organization's key, as the folder's name is. Only people who can rename
   * the folder may; the server refuses anyone else with 400.
   */
  abstract setLook(
    organizationId: OrganizationId,
    collectionId: CollectionId,
    look: FolderLook | null,
    userId: UserId,
  ): Promise<void>;
}
