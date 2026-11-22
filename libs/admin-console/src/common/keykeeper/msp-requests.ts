// Keykeeper: the MSP API calls (/api/keykeeper/msp on the server) that an
// MSP's background work needs, in the web vault and the browser extension.
// The web vault's KeykeeperMspApiService adds the console's own calls.

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import { OrganizationUserConfirmRequest } from "../organization-user";

import {
  ChangeVerification,
  Joining,
  MspDetails,
  MspJoining,
  MspSummary,
  MspTemplates,
  NewScriptToken,
  OrganizationJoining,
  OrgJoining,
  PendingMember,
  ScriptReadView,
  ScriptTokenView,
  StaleScriptGrant,
  TemplateCopy,
  TwoStepNeeded,
  TwoStepNudge,
  TwoStepNudgeKind,
} from "./msp-types";

/** Upstream's membership status for someone confirmed, who has the organization's key. */
const CONFIRMED = 2;

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

  /**
   * Upstream's confirm, with upstream's request (the org key encrypted to the
   * member's public key), saying this app let them in on its own. The server
   * changes nothing about the confirm for it: the MSP's activity log says
   * nobody compared fingerprints (DESIGN.md, "Key fingerprints").
   */
  async confirmOnItsOwn(
    organizationId: string,
    memberId: string,
    request: OrganizationUserConfirmRequest,
  ): Promise<void> {
    await this.apiService.send(
      "POST",
      `/organizations/${organizationId}/users/${memberId}/confirm`,
      { ...request, keykeeperAutomatic: true },
      true,
      false,
    );
  }

  /**
   * Whether the member is confirmed in the organization now, read fresh with
   * upstream's request for one member's details, which owners and admins may
   * make. False for any other answer, or when the server can't be asked. It
   * tells a confirm that another device made a moment before this one from a
   * real refusal (DESIGN.md, "Joining").
   */
  async isConfirmed(organizationId: string, memberId: string): Promise<boolean> {
    try {
      const member = await this.apiService.send(
        "GET",
        `/organizations/${organizationId}/users/${memberId}`,
        null,
        true,
        true,
      );
      return member?.status === CONFIRMED;
    } catch {
      return false;
    }
  }

  /** Memberships waiting for an org key in every organization where the person can confirm them. */
  async organizationsPending(): Promise<PendingMember[]> {
    return (await this.organizationsWaiting()).pending;
  }

  /**
   * Who's waiting, as `organizationsPending`, and the joining setting with
   * its seal of every organization where the person is an owner or admin.
   * None of the latter from a server that doesn't say.
   */
  async organizationsWaiting(): Promise<{
    pending: PendingMember[];
    joining: OrganizationJoining[];
  }> {
    const answer = await this.apiService.send(
      "GET",
      "/keykeeper/organizations/pending",
      null,
      true,
      true,
    );
    return { pending: answer.data, joining: answer.joining ?? [] };
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

  /**
   * Which nudge about two-step login to show, if any. A server from before
   * the second nudge says only `show`, the first. Nothing from a server that
   * doesn't say, one that names a nudge this doesn't know, or one that can't
   * be reached: the nudge never holds anything up.
   */
  async twoStepNudge(): Promise<TwoStepNudgeKind | null> {
    try {
      const answer: TwoStepNudge = await this.apiService.send(
        "GET",
        "/keykeeper/two-step-nudge",
        null,
        true,
        true,
      );
      if (answer?.nudge === undefined) {
        return answer?.show === true ? "setUp" : null;
      }
      return answer.nudge === "setUp" || answer.nudge === "stronger" ? answer.nudge : null;
    } catch {
      return null;
    }
  }

  /** "Not now", to either nudge: the server hides both for 90 days, on every device. */
  async dismissTwoStepNudge(): Promise<void> {
    await this.apiService.send("POST", "/keykeeper/two-step-nudge/dismiss", null, true, true);
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

  /**
   * Has the server make a client's Templates collection, new and empty with
   * nobody given it, named with this encrypted name. Returns its id.
   */
  async setTemplatesCollection(mspId: string, orgId: string, name: string): Promise<string> {
    const made: { collectionId: string } = await this.apiService.send(
      "PUT",
      `/keykeeper/msp/${mspId}/clients/${orgId}/templates-collection`,
      { name },
      true,
      true,
    );
    return made.collectionId;
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
