import { OrganizationUserType } from "@bitwarden/common/admin-console/enums";
import { PermissionsApi } from "@bitwarden/common/admin-console/models/api/permissions.api";
import { SelectionReadOnlyRequest } from "@bitwarden/common/admin-console/models/request/selection-read-only.request";

export class OrganizationUserInviteRequest {
  emails: string[];
  type: OrganizationUserType;
  accessSecretsManager: boolean = false;
  collections: SelectionReadOnlyRequest[] = [];
  groups: string[];
  permissions: PermissionsApi;
  /**
   * Keykeeper: seals the inviter's browser made over each invitation, by
   * email. See DESIGN.md, "Joins a hacked server can't forge".
   */
  keykeeperSeals?: Record<string, string>;

  constructor(c: {
    emails: string[];
    type: OrganizationUserType;
    groups: string[];
    permissions: PermissionsApi;
    collections: SelectionReadOnlyRequest[];
    accessSecretsManager: boolean;
  }) {
    this.emails = c.emails;
    this.type = c.type;
    this.groups = c.groups;
    this.permissions = c.permissions;
    this.collections = c.collections;
    this.accessSecretsManager = c.accessSecretsManager;
  }
}
