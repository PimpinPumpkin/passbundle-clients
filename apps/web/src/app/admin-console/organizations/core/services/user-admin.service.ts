import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  OrganizationUserApiService,
  OrganizationUserInviteRequest,
  OrganizationUserService,
  OrganizationUserUpdateRequest,
} from "@bitwarden/admin-console/common";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { Guid, OrganizationId } from "@bitwarden/common/types/guid";

import { KeykeeperJoinSealer } from "../../../../keykeeper/joining/join-sealer.service";
import { OrganizationUserAdminView } from "../views/organization-user-admin-view";

// Provided in root, not CoreOrganizationModule: standalone components (EditMemberDialogComponent)
// resolve against the root injector, not the organization module's, so a module-scoped provider is
// not visible to them. Matches GroupApiService in this folder. Both dependencies below are
// provided by the eager CoreModule.
@Injectable({ providedIn: "root" })
export class UserAdminService {
  constructor(
    private organizationUserApiService: OrganizationUserApiService,
    private organizationUserService: OrganizationUserService,
    private keykeeperJoinSealer: KeykeeperJoinSealer,
  ) {}

  async get(
    organizationId: OrganizationId,
    organizationUserId: string,
  ): Promise<OrganizationUserAdminView | undefined> {
    const userResponse = await this.organizationUserApiService.getOrganizationUser(
      organizationId,
      organizationUserId,
      {
        includeGroups: true,
      },
    );

    if (userResponse == null) {
      return undefined;
    }

    return OrganizationUserAdminView.fromResponse(organizationId, userResponse);
  }

  async saveV2(
    request: OrganizationUserUpdateRequest,
    organizationUserId: Guid,
    organization: Organization,
  ): Promise<void> {
    await firstValueFrom(
      this.organizationUserService.updateUser(organization, organizationUserId, request),
    );
  }

  async invite(emails: string[], user: OrganizationUserAdminView): Promise<void> {
    const request = new OrganizationUserInviteRequest({
      emails,
      permissions: user.permissions,
      type: user.type,
      collections: user.collections,
      groups: user.groups,
      accessSecretsManager: user.accessSecretsManager,
    });

    // Keykeeper: invitations carry the inviter's seals.
    request.keykeeperSeals = await this.keykeeperJoinSealer.inviteSeals(
      user.organizationId,
      emails,
    );
    await this.organizationUserApiService.postOrganizationUserInvite(user.organizationId, request);
  }
}
