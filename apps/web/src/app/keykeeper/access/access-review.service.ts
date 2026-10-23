import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  ClientMspStaff,
  CollectionAdminService,
  OrganizationUserApiService,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationUserType } from "@bitwarden/common/admin-console/enums";
import { FolderGrid } from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { OrganizationUserStatusType } from "@bitwarden/sdk-internal";

import { GroupApiService, GroupDetailsView } from "../../admin-console/organizations/core";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

import {
  AccessGrant,
  AccessGroupInput,
  AccessItemInput,
  AccessMemberInput,
  AccessReview,
  AccessRole,
  AccessStatus,
  reviewAccess,
} from "./access-review";

/** Who can see what in an organization, and the items it's computed from. */
export type LoadedAccess = {
  review: AccessReview;
  /** The organization's items the viewer can decrypt, by id. */
  items: Map<string, CipherView>;
  /** The same items, as the access computations take them. */
  itemInputs: AccessItemInput[];
  /**
   * Shared folders the viewer can't see, and so can't review. Owners and
   * admins see every folder; custom roles that manage members see the ones
   * they open themselves.
   */
  hiddenFolders: number;
};

const ROLES: Partial<Record<OrganizationUserType, AccessRole>> = {
  [OrganizationUserType.Owner]: "owner",
  [OrganizationUserType.Admin]: "admin",
  [OrganizationUserType.User]: "user",
  [OrganizationUserType.Custom]: "custom",
};

function statusOf(status: OrganizationUserStatusType): AccessStatus {
  if (status === OrganizationUserStatusType.Confirmed) {
    return "confirmed";
  }
  return status === OrganizationUserStatusType.Revoked ? "revoked" : "pending";
}

const grantOf = (c: {
  id: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
  keykeeper?: FolderGrid;
}): AccessGrant => ({
  id: c.id,
  readOnly: c.readOnly,
  hidePasswords: c.hidePasswords,
  manage: c.manage,
  // Keykeeper: the grant's grid (DESIGN.md, "Folders and permissions").
  keykeeper: c.keykeeper,
});

/**
 * Keykeeper: loads what the Access page and the remove and revoke
 * confirmations need, with the requests the Members, Groups, and Collections
 * pages already make. A custom role is only sent requests its permissions
 * cover (the server refuses the rest, and the web vault signs out on that):
 * members, shared folder details, and the items in its own vault.
 */
@Injectable({ providedIn: "root" })
export class KeykeeperAccessReviewService {
  constructor(
    private readonly organizationUserApiService: OrganizationUserApiService,
    private readonly groupApiService: GroupApiService,
    private readonly collectionAdminService: CollectionAdminService,
    private readonly cipherService: CipherService,
    private readonly accountService: AccountService,
    private readonly mspApi: KeykeeperMspApiService,
    private readonly apiService: ApiService,
  ) {}

  async load(org: Organization): Promise<LoadedAccess> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const [users, groupDetails, collections, items, staff, folderTotal] = await Promise.all([
      this.organizationUserApiService.getAllUsers(org.id, {
        includeCollections: true,
        includeGroups: org.useGroups,
      }),
      org.canManageGroups ? this.groupApiService.getAllDetails(org.id) : Promise.resolve(null),
      firstValueFrom(this.collectionAdminService.collectionAdminViews$(org.id, userId)),
      this.items(org, userId),
      this.mspStaff(org),
      this.folderTotal(org),
    ]);

    // Groups' folders, from the groups themselves where the viewer can list
    // them, and otherwise from the folders' own details (without names).
    let groups: AccessGroupInput[];
    if (groupDetails != null) {
      groups = groupDetails.map((g: GroupDetailsView): AccessGroupInput => ({
        id: g.id,
        name: g.name,
        collections: g.collections.map(grantOf),
      }));
    } else {
      const byGroup = new Map<string, AccessGrant[]>();
      for (const c of collections) {
        for (const g of c.groups ?? []) {
          byGroup.set(g.id, [...(byGroup.get(g.id) ?? []), grantOf({ ...g, id: c.id })]);
        }
      }
      groups = [...byGroup].map(([id, grants]): AccessGroupInput => ({
        id,
        name: null,
        collections: grants,
      }));
    }

    const members: AccessMemberInput[] = (users.data ?? []).map((u) => {
      const mspStaff = staff.get(u.id);
      return {
        id: u.id,
        name: u.name ?? null,
        email: u.email,
        role: ROLES[u.type] ?? "user",
        status: statusOf(u.status),
        allItems:
          (u.type === OrganizationUserType.Custom && !!u.permissions?.editAnyCollection) ||
          !!mspStaff?.vaultItems,
        mspStaff: mspStaff != null,
        collections: (u.collections ?? []).map(grantOf),
        groups: u.groups ?? [],
      };
    });

    const itemInputs: AccessItemInput[] = items.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      collectionIds: c.collectionIds ?? [],
      deleted: c.isDeleted,
    }));
    const review = reviewAccess({
      members,
      groups,
      folders: collections.map((c) => ({ id: c.id, name: c.name })),
      items: itemInputs,
      adminsSeeEverything: org.allowAdminAccessToAllCollectionItems,
    });

    return {
      review,
      items: new Map(items.map((c) => [c.id, c])),
      itemInputs,
      hiddenFolders: folderTotal == null ? 0 : Math.max(0, folderTotal - collections.length),
    };
  }

  /**
   * How many shared folders the organization has, for a viewer who may not
   * see them all: the list the Members page loads, names still encrypted.
   * Owners and admins see every folder already.
   */
  private async folderTotal(org: Organization): Promise<number | null> {
    if (org.canEditAllCiphers) {
      return null;
    }
    const response = await this.apiService.getCollections(org.id);
    return response.data?.length ?? 0;
  }

  /**
   * The organization's items: all of them for owners and admins, as the
   * admin console's vault loads them; for anyone else, the ones in their own
   * vault, with no request at all.
   */
  private async items(org: Organization, userId: UserId): Promise<CipherView[]> {
    if (org.canEditAllCiphers) {
      return this.cipherService.getAllFromApiForOrganization(org.id);
    }
    const all = await this.cipherService.getAllDecrypted(userId);
    return all.filter((c) => c.organizationId === org.id);
  }

  /**
   * The MSP's people here, by membership, as the Members page shows them.
   * Asked only by owners and admins, like the Members page does.
   */
  private async mspStaff(org: Organization): Promise<Map<string, ClientMspStaff>> {
    if (!org.isOwner && !org.isAdmin) {
      return new Map();
    }
    try {
      const info = await this.mspApi.getOrganizationMsp(org.id);
      return new Map((info?.staff ?? []).map((s) => [s.memberId, s]));
    } catch {
      return new Map();
    }
  }
}
