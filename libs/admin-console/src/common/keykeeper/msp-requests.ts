// Keykeeper: the MSP API calls (/api/keykeeper/msp on the server) that an
// MSP's background work needs, in the web vault and the browser extension.
// The web vault's KeykeeperMspApiService adds the console's own calls.

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import {
  ChangeVerification,
  Joining,
  MspDetails,
  MspJoining,
  MspSummary,
  MspTemplates,
  NewScriptToken,
  OrgJoining,
  PendingMember,
  ScriptReadView,
  ScriptTokenView,
  StaleScriptGrant,
  TemplateCopy,
  TwoStepNeeded,
} from "./msp-types";

/**
 * Only the proof's own field for a request's body: the code when there is
 * one, otherwise the master password hash. Upstream's request also has a
 * field for signing in with another device, which these changes never take.
 */
export function verificationFields(verification: ChangeVerification): ChangeVerification {
  return verification.otp != null
    ? { otp: verification.otp }
    : { masterPasswordHash: verification.masterPasswordHash };
}

export class KeykeeperMspRequests {
  constructor(protected readonly apiService: ApiService) {}

  /** The MSPs the person is staff of, with their role in each. */
  async list(): Promise<MspSummary[]> {
    return (await this.apiService.send("GET", "/keykeeper/msp", null, true, true)).data;
  }

  async get(mspId: string): Promise<MspDetails> {
    return this.apiService.send("GET", `/keykeeper/msp/${mspId}`, null, true, true);
  }

  /** Memberships waiting for an org key in clients where the person can confirm them. */
  async pending(mspId: string): Promise<PendingMember[]> {
    return (await this.apiService.send("GET", `/keykeeper/msp/${mspId}/pending`, null, true, true))
      .data;
  }

  /** Memberships waiting for an org key in every organization where the person can confirm them. */
  async organizationsPending(): Promise<PendingMember[]> {
    return (await this.apiService.send("GET", "/keykeeper/organizations/pending", null, true, true))
      .data;
  }

  /**
   * The person's organizations that can't confirm them until they turn on
   * two-step login. None from a server that doesn't say.
   */
  async twoStepNeeded(): Promise<TwoStepNeeded[]> {
    try {
      return (
        await this.apiService.send(
          "GET",
          "/keykeeper/organizations/two-step-needed",
          null,
          true,
          true,
        )
      ).data;
    } catch {
      return [];
    }
  }

  async getOrgJoining(orgId: string): Promise<OrgJoining> {
    return this.apiService.send(
      "GET",
      `/keykeeper/organizations/${orgId}/joining`,
      null,
      true,
      true,
    );
  }

  /** Sets the organization's own setting, with the seal over it and the domains. */
  async setOrgJoining(orgId: string, joining: Joining, seal?: string): Promise<OrgJoining> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/organizations/${orgId}/joining`,
      { ...joining, seal },
      true,
      true,
    );
  }

  /** Puts the organization back on its MSP's default, or the server's, with its seal. */
  async resetOrgJoining(orgId: string, seal?: string): Promise<OrgJoining> {
    return this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/joining`,
      { seal },
      true,
      true,
    );
  }

  async getMspJoining(mspId: string): Promise<MspJoining> {
    return this.apiService.send("GET", `/keykeeper/msp/${mspId}/joining`, null, true, true);
  }

  /** Sets the MSP's default, with a seal for each client that follows it. */
  async setMspJoining(
    mspId: string,
    joining: Joining,
    seals?: Record<string, string>,
  ): Promise<MspJoining> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/joining`,
      { ...joining, seals },
      true,
      true,
    );
  }

  async getTemplates(mspId: string): Promise<MspTemplates> {
    return this.apiService.send("GET", `/keykeeper/msp/${mspId}/templates`, null, true, true);
  }

  /** Records the copies just written into clients. */
  async recordTemplateCopies(
    mspId: string,
    templateId: string,
    copies: TemplateCopy[],
  ): Promise<void> {
    await this.apiService.send(
      "POST",
      `/keykeeper/msp/${mspId}/templates/${templateId}/copies`,
      { copies },
      true,
      false,
    );
  }

  /** Records a client's Templates collection. */
  async setTemplatesCollection(mspId: string, orgId: string, collectionId: string): Promise<void> {
    await this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/clients/${orgId}/templates-collection`,
      { collectionId },
      true,
      true,
    );
  }

  // Script access (docs/script-access.md in the meta repo).

  async scriptTokens(orgId: string): Promise<ScriptTokenView[]> {
    return (
      await this.apiService.send(
        "GET",
        `/keykeeper/organizations/${orgId}/script-tokens`,
        null,
        true,
        true,
      )
    ).data;
  }

  /** Makes a token, with the person's proof (ChangeVerification). */
  async createScriptToken(
    orgId: string,
    token: NewScriptToken,
    verification: ChangeVerification,
  ): Promise<ScriptTokenView> {
    return this.apiService.send(
      "POST",
      `/keykeeper/organizations/${orgId}/script-tokens`,
      { ...token, ...verificationFields(verification) },
      true,
      true,
    );
  }

  async revokeScriptToken(orgId: string, tokenId: string): Promise<ScriptTokenView> {
    return this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/script-tokens/${tokenId}`,
      null,
      true,
      true,
    );
  }

  /**
   * Adds a grant, or refreshes its copy. Adding an item, or changing which of
   * its fields the token gets (its sealed spec), needs the person's proof;
   * refreshing a copy with the same spec, as apps do in the background,
   * doesn't.
   */
  async setScriptGrant(
    orgId: string,
    tokenId: string,
    itemId: string,
    grant: { copy: string; revision: string; sealedSpec: string },
    verification?: ChangeVerification,
  ): Promise<ScriptTokenView> {
    return this.apiService.send(
      "PUT",
      `/keykeeper/organizations/${orgId}/script-tokens/${tokenId}/grants/${itemId}`,
      verification == null ? grant : { ...grant, ...verificationFields(verification) },
      true,
      true,
    );
  }

  async removeScriptGrant(
    orgId: string,
    tokenId: string,
    itemId: string,
  ): Promise<ScriptTokenView> {
    return this.apiService.send(
      "DELETE",
      `/keykeeper/organizations/${orgId}/script-tokens/${tokenId}/grants/${itemId}`,
      null,
      true,
      true,
    );
  }

  async scriptReads(orgId: string, tokenId: string): Promise<ScriptReadView[]> {
    return (
      await this.apiService.send(
        "GET",
        `/keykeeper/organizations/${orgId}/script-tokens/${tokenId}/reads`,
        null,
        true,
        true,
      )
    ).data;
  }

  /** Grants whose copies are behind their items, on items this person can edit. None from an older server. */
  async staleScriptGrants(): Promise<StaleScriptGrant[]> {
    try {
      return (await this.apiService.send("GET", "/keykeeper/script-grants/stale", null, true, true))
        .data;
    } catch {
      return [];
    }
  }
}
