// Keykeeper: the MSP API (/api/keykeeper/msp on the server). Creating a client
// organization makes its keys in the browser the same way upstream's "New
// organization" does, and confirming members uses upstream's confirm request,
// so the server never sees a key it could decrypt with. Changes to staff, how
// people join, and install commands carry this browser's seals and join
// secrets (KeykeeperJoinSealer), so other apps can let people in on their own
// without trusting the server. See DESIGN.md, "Joins a hacked server can't forge".

import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  AddStaffResult,
  ClientEnrollment,
  ClientMsp,
  ClientPreset,
  DefaultPolicyResult,
  InvitationInfo,
  Joining,
  KeykeeperJoinSeals,
  KeykeeperMspRequests,
  MspJoining,
  MspPolicies,
  MspRemoval,
  MspRole,
  MspSiteFixes,
  MspSummary,
  OrgJoining,
  ProvisioningView,
  SiteFixView,
  SsoSettings,
  SsoView,
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

import { KeykeeperJoinSealer, ReportedJoining } from "../joining/join-sealer.service";

import { MspEvent } from "./msp-activity";
import { reachesEveryClient } from "./technician-access";

/** Email domains as the server keeps them, so a seal covers exactly those. */
export function normalizeDomains(entries: string[]): string[] {
  const domains: string[] = [];
  for (const entry of entries) {
    const domain = entry.trim().replace(/^@+/, "").replace(/\.+$/, "").toLowerCase();
    if (domain !== "" && !domains.includes(domain)) {
      domains.push(domain);
    }
  }
  return domains;
}

/** What the server reports about an organization's joining, as the sealer reads it. */
function reported(joining: OrgJoining): ReportedJoining {
  return {
    autoConfirm: joining.autoConfirm,
    domains: joining.domains ?? [],
    seal: joining.seal ?? null,
  };
}

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
  MspRemoval,
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
    private readonly sealer: KeykeeperJoinSealer,
  ) {
    super(apiService);
  }

  /** Leaves an MSP admin's seals and join secrets for its clients. */
  private async putMspSeals(
    mspId: string,
    seals: {
      staff?: { organizationId: string; email: string; seal: string }[];
      joining?: { organizationId: string; seal: string }[];
      secrets?: { organizationId: string; secret: string }[];
    },
  ): Promise<void> {
    await this.apiService.send("PUT", `/keykeeper/msp/${mspId}/seals`, seals, true, false);
  }

  /**
   * Seals a staff member's place in the clients they reach, where this person
   * has a confirmed place as an owner or admin: the server refuses the rest,
   * such as a client that revoked them.
   */
  private async sealStaff(
    mspId: string,
    email: string,
    role: MspRole,
    access: TechnicianAccess | null | undefined,
  ): Promise<void> {
    const clients = (await this.get(mspId)).clients
      .filter((c) => c.you?.status === 2 && c.you.type <= 1)
      .map((c) => c.id);
    const reached =
      role === "admin" || reachesEveryClient(access ?? undefined)
        ? clients
        : clients.filter((c) => access!.clients.includes(c));
    const staff = await this.sealer.staffSeals(reached, email);
    if (staff.length > 0) {
      await this.putMspSeals(mspId, { staff });
    }
  }

  /**
   * Seals a new organization whose key this browser just made: how people
   * join it (approval or not, no domains yet), its install command's join
   * secret, and the places of staff who reach every client.
   */
  private async sealNew(
    key: OrgKey,
    orgId: string,
    autoConfirm: boolean,
    withSecret: boolean,
    staffEmails: string[],
  ) {
    const seals = new KeykeeperJoinSeals();
    const joinKey = await seals.joinKey(key.toEncoded());
    return {
      joining: await seals.joiningSeal(joinKey, orgId, autoConfirm, []),
      secret: withSecret
        ? (await this.encryptService.encryptString(seals.newJoinSecret(), key)).encryptedString
        : undefined,
      staff: await Promise.all(
        staffEmails.map(async (email) => ({
          organizationId: orgId,
          email,
          seal: await seals.staffSeal(joinKey, orgId, email),
        })),
      ),
    };
  }

  /** Sets the organization's own setting, sealed. */
  override async setOrgJoining(orgId: string, joining: Joining): Promise<OrgJoining> {
    const current = await this.getOrgJoining(orgId);
    const seal = await this.sealer.resealJoining(orgId, joining.autoConfirm, reported(current));
    return super.setOrgJoining(orgId, joining, seal);
  }

  /** Puts the organization back on its MSP's default, or the server's, sealed. */
  override async resetOrgJoining(orgId: string): Promise<OrgJoining> {
    const current = await this.getOrgJoining(orgId);
    const seal = await this.sealer.resealJoining(
      orgId,
      current.default.autoConfirm,
      reported(current),
    );
    return super.resetOrgJoining(orgId, seal);
  }

  /** Sets the MSP's default, with a seal for each client that follows it. */
  override async setMspJoining(mspId: string, joining: Joining): Promise<MspJoining> {
    const current = await this.getMspJoining(mspId);
    const seals: Record<string, string> = {};
    for (const client of current.following ?? []) {
      const seal = await this.sealer.resealJoining(client.organizationId, joining.autoConfirm, {
        autoConfirm: current.default.autoConfirm,
        domains: client.domains,
        seal: client.seal,
      });
      if (seal != null) {
        seals[client.organizationId] = seal;
      }
    }
    return super.setMspJoining(mspId, joining, seals);
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
    // Sealed with the key made here: the MSP's default for how people join,
    // a join secret for the install command, and the staff who reach every
    // client, as the console lists them.
    const msp = await this.get(mspId);
    const joining = await this.getMspJoining(mspId);
    const everyClient = [
      ...msp.staff.filter((s) => s.role === "admin" || reachesEveryClient(s.access ?? undefined)),
      ...msp.invites.filter((i) => i.role === "admin" || reachesEveryClient(i.access ?? undefined)),
    ].map((s) => s.email);
    const sealed = await this.sealNew(
      key,
      created.id,
      joining.default.autoConfirm,
      true,
      everyClient,
    );
    await this.putMspSeals(mspId, {
      staff: sealed.staff,
      joining: [{ organizationId: created.id, seal: sealed.joining }],
      secrets: [{ organizationId: created.id, secret: sealed.secret! }],
    });
    return created.id;
  }

  /**
   * Creates an organization outside any MSP, owned by the person, with its
   * keys made the way upstream's "New organization" makes them. The Business
   * preset also gets "Everyone" and "Admins" collections, its policies, and an
   * install command. Returns its id.
   */
  async createOrganization(name: string, preset: ClientPreset): Promise<string> {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    const userId = account!.id;
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
      "/keykeeper/organizations",
      {
        name,
        preset,
        billingEmail: account!.email,
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
    // Sealed with the key made here: people are let in on their own (the
    // server's default), and the Business preset's install command gets a
    // join secret.
    const sealed = await this.sealNew(key, created.id, true, business, []);
    await this.apiService.send(
      "PUT",
      `/keykeeper/organizations/${created.id}/seals`,
      { joining: sealed.joining, secret: sealed.secret },
      true,
      false,
    );
    return created.id;
  }

  /**
   * A company's own organization's install command, or for an MSP's client,
   * which IT provider manages it. Anyone but its owners and admins gets "not found".
   */
  async getOrgEnrollment(
    orgId: string,
  ): Promise<ClientEnrollment | { provider: string; removedSinceToken?: number }> {
    return this.apiService.send(
      "GET",
      `/keykeeper/organizations/${orgId}/enrollment`,
      null,
      true,
      true,
    );
  }

  /** Makes a company's own install command, or replaces it so commands with the old token stop working for new joins. */
  async replaceOrgEnrollment(orgId: string): Promise<ClientEnrollment> {
    return this.apiService.send(
      "POST",
      `/keykeeper/organizations/${orgId}/enrollment`,
      { secret: await this.sealer.newSecret(orgId) },
      true,
      true,
    );
  }

  /** Gives a company's own install command a join secret, keeping its token. */
  async setOrgEnrollmentSecret(orgId: string): Promise<void> {
    await this.apiService.send(
      "PUT",
      `/keykeeper/organizations/${orgId}/seals`,
      { secret: await this.sealer.newSecret(orgId) },
      true,
      false,
    );
  }

  /** Limits a company's own install command to accounts at these email domains; none lets anyone join. */
  async setOrgEnrollmentDomains(orgId: string, domains: string[]): Promise<ClientEnrollment> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/organizations/${orgId}/enrollment/domains`,
      { domains, seal: await this.domainsSeal(orgId, domains) },
      true,
      true,
    );
  }

  /** The seal for an organization's new email domains, as the server will keep them. */
  private async domainsSeal(orgId: string, domains: string[]): Promise<string | undefined> {
    const current = await this.getOrgJoining(orgId);
    return this.sealer.sealDomains(orgId, normalizeDomains(domains), reported(current));
  }

  // Provisioning from Microsoft Entra ID (DESIGN.md, "Provisioning from Entra ID").

  /** The organization's Provisioning page. Anyone but those who manage it gets "not found". */
  async getProvisioning(orgId: string): Promise<ProvisioningView> {
    return this.apiService.send(
      "GET",
      `/keykeeper/organizations/${orgId}/provisioning`,
      null,
      true,
      true,
    );
  }

  /** Makes the organization's provisioning token, or replaces it; the answer carries it once. */
  async makeProvisioningToken(orgId: string): Promise<ProvisioningView> {
    return this.apiService.send(
      "POST",
      `/keykeeper/organizations/${orgId}/provisioning/token`,
      null,
      true,
      true,
    );
  }

  async revokeProvisioningToken(orgId: string): Promise<ProvisioningView> {
    return this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/provisioning/token`,
      null,
      true,
      true,
    );
  }

  /**
   * Lets in people the directory invited: this browser seals their
   * invitations, as it does for invitations sent from the Members page, for
   * the people its person chose from the waiting list.
   */
  async letInProvisioned(orgId: string, emails: string[]): Promise<ProvisioningView> {
    const seals = await this.sealer.inviteSeals(orgId, emails);
    const list = emails
      .filter((e) => seals[e] != null)
      .map((email) => ({ email, seal: seals[email] }));
    if (list.length !== emails.length) {
      throw new Error(
        "This browser doesn't have the organization's key yet. Reload and try again.",
      );
    }
    return this.apiService.send(
      "PUT",
      `/keykeeper/organizations/${orgId}/provisioning/seals`,
      { seals: list },
      true,
      true,
    );
  }

  // Single sign-on with Microsoft Entra ID (DESIGN.md, "Sign in with Microsoft Entra ID").

  /** The organization's Single sign-on page. Anyone but those who manage it gets "not found". */
  async getSso(orgId: string): Promise<SsoView> {
    return this.apiService.send("GET", `/keykeeper/organizations/${orgId}/sso`, null, true, true);
  }

  /** Saves the settings. The server checks that Microsoft knows the tenant before turning it on. */
  async saveSso(orgId: string, settings: SsoSettings): Promise<SsoView> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/organizations/${orgId}/sso`,
      settings,
      true,
      true,
    );
  }

  async addSsoDomain(orgId: string, domain: string): Promise<SsoView> {
    return this.apiService.send(
      "POST",
      `/keykeeper/organizations/${orgId}/sso/domains`,
      { domain },
      true,
      true,
    );
  }

  /** Looks for the domain's TXT record now. */
  async verifySsoDomain(orgId: string, domainId: string): Promise<SsoView> {
    return this.apiService.send(
      "POST",
      `/keykeeper/organizations/${orgId}/sso/domains/${domainId}/verify`,
      null,
      true,
      true,
    );
  }

  async removeSsoDomain(orgId: string, domainId: string): Promise<SsoView> {
    return this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/sso/domains/${domainId}`,
      null,
      true,
      true,
    );
  }

  /** With Require single sign-on on, replaces the API keys of the members it covers. */
  async rotateSsoApiKeys(orgId: string): Promise<SsoView> {
    return this.apiService.send(
      "POST",
      `/keykeeper/organizations/${orgId}/sso/rotate-api-keys`,
      null,
      true,
      true,
    );
  }

  /** Unlinks an account: its person's next sign-in links again, under the rules. */
  async unlinkSso(orgId: string, userId: string): Promise<SsoView> {
    return this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/sso/links/${userId}`,
      null,
      true,
      true,
    );
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
      { secret: await this.sealer.newSecret(orgId) },
      true,
      true,
    );
  }

  /** Gives a client's install command a join secret, keeping its token. MSP admins. */
  async setEnrollmentSecret(mspId: string, orgId: string): Promise<void> {
    const secret = await this.sealer.newSecret(orgId);
    if (secret != null) {
      await this.putMspSeals(mspId, { secrets: [{ organizationId: orgId, secret }] });
    }
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
      { domains, seal: await this.domainsSeal(orgId, domains) },
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
  /** Changes a default; `keep` names following clients to leave as they are. */
  async setDefaultPolicy(
    mspId: string,
    type: number,
    policy: { enabled: boolean; data: any },
    keep: string[] = [],
  ): Promise<DefaultPolicyResult> {
    const result: DefaultPolicyResult = await this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/policies/${type}`,
      { ...policy, keep },
      true,
      true,
    );
    await this.syncChangedPolicies(result);
    return result;
  }

  /** Puts clients back on the default for one policy, replacing their own setting. */
  async useDefaultPolicy(
    mspId: string,
    type: number,
    clients: string[],
  ): Promise<Omit<DefaultPolicyResult, "kept">> {
    const result: Omit<DefaultPolicyResult, "kept"> = await this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/policies/${type}/apply`,
      { clients },
      true,
      true,
    );
    await this.syncChangedPolicies(result);
    return result;
  }

  /**
   * Clients' policies reach this vault when it syncs, and nothing tells it to
   * sync when a default changes them. Upstream's admin console puts a policy
   * it saves straight into the vault; after a default changed clients, a sync
   * does the same, so their admin consoles act on it at once, such as
   * offering Recover account right after account recovery is turned on.
   */
  private async syncChangedPolicies(result: { changed?: unknown[] }) {
    if ((result.changed?.length ?? 0) > 0) {
      await this.syncService.fullSync(true);
    }
  }

  /**
   * For a client's own owners: removes the MSP and all of its staff from the
   * organization, and what they made there. Says what went.
   */
  async removeOrganizationMsp(orgId: string): Promise<MspRemoval> {
    return this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/msp`,
      null,
      true,
      true,
    );
  }

  /** Adds someone to the staff. A technician gets `access`, or every client as admin without it. */
  async addStaff(
    mspId: string,
    email: string,
    role: MspRole,
    access?: TechnicianAccess,
  ): Promise<AddStaffResult> {
    const result: AddStaffResult = await this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/staff`,
      { email, role, access: role === "technician" ? access : undefined },
      true,
      true,
    );
    await this.sealStaff(mspId, email, role, role === "technician" ? access : null);
    return result;
  }

  /** Changes a technician's access, in every client at once. */
  async setAccess(
    mspId: string,
    userId: string,
    access: TechnicianAccess,
  ): Promise<TechnicianAccess> {
    const saved: TechnicianAccess = await this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/staff/${userId}/access`,
      access,
      true,
      true,
    );
    const email = (await this.get(mspId)).staff.find((s) => s.userId === userId)?.email;
    if (email != null) {
      await this.sealStaff(mspId, email, "technician", saved);
    }
    return saved;
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
    if (role === "admin") {
      const email = (await this.get(mspId)).staff.find((s) => s.userId === userId)?.email;
      if (email != null) {
        await this.sealStaff(mspId, email, role, null);
      }
    }
  }

  /** An MSP's site rules and the fixes its staff shared. MSP admins. */
  async getSiteFixes(mspId: string): Promise<MspSiteFixes> {
    return this.apiService.send("GET", `/keykeeper/msp/${mspId}/site-fixes`, null, true, true);
  }

  /** Applies a fix to every client at once. */
  async addSiteRule(mspId: string, fix: SiteFixView): Promise<void> {
    const { host, field, fill } = fix;
    await this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/site-rules`,
      { host, field, fill },
      true,
      true,
    );
  }

  async removeSiteRule(mspId: string, ruleId: string): Promise<void> {
    await this.apiService.send(
      "DELETE",
      `/keykeeper/msp/${mspId}/site-rules/${ruleId}`,
      null,
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
