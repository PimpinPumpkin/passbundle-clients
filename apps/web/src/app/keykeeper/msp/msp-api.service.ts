// Keykeeper: the MSP API (/api/keykeeper/msp on the server). Creating a client
// organization makes its keys in the browser the same way upstream's "New
// organization" does, and confirming members uses upstream's confirm request,
// so the server never sees a key it could decrypt with.

import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  AddStaffResult,
  ClientEnrollment,
  ClientMsp,
  ClientPreset,
  DefaultPolicyResult,
  InvitationInfo,
  KeykeeperMspRequests,
  MspPolicies,
  MspRole,
  MspSummary,
  TechnicianAccess,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import { MspEvent } from "./msp-activity";

export type {
  MspRole,
  ClientPreset,
  MspSummary,
  MspClient,
  CustomPermissions,
  TechnicianAccess,
  MspStaffMember,
  MspInvite,
  MspDetails,
  AddStaffResult,
  InvitationInfo,
  ClientEnrollment,
  ClientMsp,
  MspPolicy,
  MspPolicies,
  DefaultPolicyResult,
  MspTemplates,
  TemplateCopy,
} from "@bitwarden/admin-console/common";

@Injectable({ providedIn: "root" })
export class KeykeeperMspApiService extends KeykeeperMspRequests {
  constructor(
    apiService: ApiService,
    private readonly accountService: AccountService,
    private readonly keyService: KeyService,
    private readonly encryptService: EncryptService,
    private readonly i18nService: I18nService,
    private readonly syncService: SyncService,
  ) {
    super(apiService);
  }

  async create(name: string): Promise<MspSummary> {
    return this.apiService.send("POST", "/keykeeper/msp", { name }, true, true);
  }

  /**
   * Creates a client organization, with its keys made here, like upstream's
   * new organization. The Business preset also gets "Everyone" and "Admins"
   * collections; the server turns on its policies. Returns the new client's id.
   */
  async createClient(mspId: string, name: string, preset: ClientPreset): Promise<string> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const [encryptedKey, key] = await this.keyService.makeOrgKey<OrgKey>(userId);
    const [publicKey, encryptedPrivateKey] = await this.keyService.makeKeyPair(key);
    const business = preset === "business";
    const collectionName = await this.encryptService.encryptString(
      business ? "Everyone" : this.i18nService.t("defaultCollection"),
      key,
    );
    const adminsCollectionName = business
      ? (await this.encryptService.encryptString("Admins", key)).encryptedString
      : undefined;
    const created = await this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/clients`,
      {
        name,
        preset,
        collectionName: collectionName.encryptedString,
        adminsCollectionName,
        key: encryptedKey.encryptedString,
        keys: { publicKey, encryptedPrivateKey: encryptedPrivateKey.encryptedString },
      },
      true,
      true,
    );
    await this.apiService.refreshIdentityToken();
    await this.syncService.fullSync(true);
    return created.id;
  }

  /**
   * Creates an organization outside any MSP, owned by the person, with its
   * keys made the way upstream's "New organization" makes them. Returns its id.
   */
  async createOrganization(name: string): Promise<string> {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    const userId = account!.id;
    const [encryptedKey, key] = await this.keyService.makeOrgKey<OrgKey>(userId);
    const [publicKey, encryptedPrivateKey] = await this.keyService.makeKeyPair(key);
    const collectionName = await this.encryptService.encryptString(
      this.i18nService.t("defaultCollection"),
      key,
    );
    const created = await this.apiService.send(
      "POST",
      "/organizations",
      {
        name,
        billingEmail: account!.email,
        collectionName: collectionName.encryptedString,
        key: encryptedKey.encryptedString,
        keys: { publicKey, encryptedPrivateKey: encryptedPrivateKey.encryptedString },
        // Free: the server has no plans or billing.
        planType: 0,
      },
      true,
      true,
    );
    await this.apiService.refreshIdentityToken();
    await this.syncService.fullSync(true);
    return created.id;
  }

  /** Adds a template, or changes its source or which clients get it. */
  async setTemplate(
    mspId: string,
    templateId: string,
    template: { sourceCipherId: string; allClients: boolean; clients: string[] },
  ): Promise<void> {
    await this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/templates/${templateId}`,
      template,
      true,
      true,
    );
  }

  /** Stops sending a template. Its copies stay unless they were deleted first. */
  async stopTemplate(mspId: string, templateId: string): Promise<void> {
    await this.apiService.send(
      "DELETE",
      `/keykeeper/msp/${mspId}/templates/${templateId}`,
      null,
      true,
      false,
    );
  }

  /** The MSP's audit log, newest first, older than `before` if given. */
  async listEvents(mspId: string, before?: string, limit = 50): Promise<MspEvent[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) {
      query.set("before", before);
    }
    return (
      await this.apiService.send("GET", `/keykeeper/msp/${mspId}/events?${query}`, null, true, true)
    ).data;
  }

  /** A client's enrollment token, for its RMM install command. */
  async getEnrollment(mspId: string, orgId: string): Promise<ClientEnrollment> {
    return this.apiService.send(
      "GET",
      `/keykeeper/msp/${mspId}/clients/${orgId}/enrollment`,
      null,
      true,
      true,
    );
  }

  /** Replaces a client's enrollment token; install commands with the old one stop working for new joins. */
  async replaceEnrollment(mspId: string, orgId: string): Promise<ClientEnrollment> {
    return this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/clients/${orgId}/enrollment`,
      null,
      true,
      true,
    );
  }

  /** Limits a client's install command to accounts at these email domains; none lets anyone join. */
  async setEnrollmentDomains(
    mspId: string,
    orgId: string,
    domains: string[],
  ): Promise<ClientEnrollment> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/clients/${orgId}/enrollment/domains`,
      { domains },
      true,
      true,
    );
  }

  /** For a client's owners and admins: the MSP that manages the organization, and its staff there. */
  async getOrganizationMsp(orgId: string): Promise<ClientMsp> {
    return this.apiService.send("GET", `/keykeeper/organizations/${orgId}/msp`, null, true, true);
  }

  async getPolicies(mspId: string): Promise<MspPolicies> {
    return this.apiService.send("GET", `/keykeeper/msp/${mspId}/policies`, null, true, true);
  }

  /** Changes a default, and with it every client that follows it. */
  async setDefaultPolicy(
    mspId: string,
    type: number,
    policy: { enabled: boolean; data: any },
  ): Promise<DefaultPolicyResult> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/policies/${type}`,
      policy,
      true,
      true,
    );
  }

  /** Puts clients back on the default for one policy, replacing their own setting. */
  async useDefaultPolicy(
    mspId: string,
    type: number,
    clients: string[],
  ): Promise<Omit<DefaultPolicyResult, "kept">> {
    return this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/policies/${type}/apply`,
      { clients },
      true,
      true,
    );
  }

  /** For a client's own owners: removes the MSP and all of its staff from the organization. */
  async removeOrganizationMsp(orgId: string): Promise<void> {
    await this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/msp`,
      null,
      true,
      false,
    );
  }

  /** Adds someone to the staff. A technician gets `access`, or every client as admin without it. */
  async addStaff(
    mspId: string,
    email: string,
    role: MspRole,
    access?: TechnicianAccess,
  ): Promise<AddStaffResult> {
    return this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/staff`,
      { email, role, access: role === "technician" ? access : undefined },
      true,
      true,
    );
  }

  /** Changes a technician's access, in every client at once. */
  async setAccess(
    mspId: string,
    userId: string,
    access: TechnicianAccess,
  ): Promise<TechnicianAccess> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/staff/${userId}/access`,
      access,
      true,
      true,
    );
  }

  async cancelInvite(mspId: string, inviteId: string): Promise<void> {
    await this.apiService.send(
      "DELETE",
      `/keykeeper/msp/${mspId}/invites/${inviteId}`,
      null,
      true,
      false,
    );
  }

  async invitationInfo(token: string): Promise<InvitationInfo> {
    return this.apiService.send("POST", "/keykeeper/msp/invites/info", { token }, true, true);
  }

  async acceptInvitation(token: string): Promise<{ mspId: string; role: MspRole }> {
    return this.apiService.send("POST", "/keykeeper/msp/invites/accept", { token }, true, true);
  }

  async changeRole(mspId: string, userId: string, role: MspRole): Promise<void> {
    await this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/staff/${userId}`,
      { role },
      true,
      false,
    );
  }

  async removeStaff(mspId: string, userId: string): Promise<void> {
    await this.apiService.send(
      "DELETE",
      `/keykeeper/msp/${mspId}/staff/${userId}`,
      null,
      true,
      false,
    );
  }
}
