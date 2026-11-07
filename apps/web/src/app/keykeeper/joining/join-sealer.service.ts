import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  joiningSealSource,
  JoiningSource,
  KeykeeperJoiningMemory,
  KeykeeperJoinSeals,
  ReportedJoining,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import {
  CryptoFunctionService,
  EncryptService,
  EncString,
  LegacyCompatKeyService,
} from "@bitwarden/legacy-crypto";

export type { ReportedJoining };

/**
 * Keykeeper: the seals and join secrets an owner's or admin's browser makes
 * when they invite someone, change how people join, or make an install
 * command, so other apps can let people in on their own without trusting
 * the server. Made only on these actions, never from what the server lists
 * on its own, and for an MSP's clients only in those whose client seal
 * checks out (`trustedClients`). A joining seal is checked against, and
 * sealed after, the newest this device has seen for the organization
 * (KeykeeperJoiningMemory), so a change never builds on an older setting the
 * server shows again. See DESIGN.md, "Joins a hacked server can't forge".
 */
@Injectable({ providedIn: "root" })
export class KeykeeperJoinSealer {
  private readonly seals = new KeykeeperJoinSeals();

  constructor(
    private readonly accountService: AccountService,
    private readonly keyService: KeyService,
    private readonly encryptService: EncryptService,
    private readonly cryptoFunctionService: CryptoFunctionService,
    private readonly apiService: ApiService,
    private readonly stateProvider: StateProvider,
    private readonly legacyCompatKeyService: LegacyCompatKeyService,
  ) {}

  /** The newest joining seal this device has seen for each organization. */
  private get memory(): KeykeeperJoiningMemory {
    return new KeykeeperJoiningMemory(this.stateProvider, this.seals);
  }

  private userId(): Promise<UserId> {
    return firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
  }

  /** The organization's key, if this person holds it. */
  private async orgKey(organizationId: string): Promise<OrgKey | null> {
    const keys = await firstValueFrom(this.keyService.orgKeys$(await this.userId()));
    return keys?.[organizationId as OrganizationId] ?? null;
  }

  private async joinKey(organizationId: string): Promise<Uint8Array | null> {
    const key = await this.orgKey(organizationId);
    return key == null ? null : this.seals.joinKey(key.toEncoded());
  }

  /** Seals for invitations to these emails, by email. Empty without the organization's key. */
  async inviteSeals(organizationId: string, emails: string[]): Promise<Record<string, string>> {
    const joinKey = await this.joinKey(organizationId);
    const seals: Record<string, string> = {};
    if (joinKey != null) {
      for (const email of emails) {
        seals[email] = await this.seals.inviteSeal(joinKey, organizationId, email);
      }
    }
    return seals;
  }

  /** Staff seals for someone in each of these clients whose key this person holds. */
  async staffSeals(
    organizationIds: string[],
    email: string,
  ): Promise<{ organizationId: string; email: string; seal: string }[]> {
    const out = [];
    for (const organizationId of organizationIds) {
      const joinKey = await this.joinKey(organizationId);
      if (joinKey != null) {
        out.push({
          organizationId,
          email,
          seal: await this.seals.staffSeal(joinKey, organizationId, email),
        });
      }
    }
    return out;
  }

  /** The seal that says this organization is this MSP's client, made where its key was. */
  async clientSeal(organizationId: string, mspId: string): Promise<string | undefined> {
    const joinKey = await this.joinKey(organizationId);
    return joinKey == null ? undefined : this.seals.clientSeal(joinKey, organizationId, mspId);
  }

  /**
   * Of the clients the server lists for an MSP, those this person holds the
   * key of and whose client seal for this MSP checks out. A hacked server
   * could list any organization the person belongs to as a client; seals and
   * template copies go only to these.
   */
  async trustedClients<T extends { id: string; seal?: string | null }>(
    mspId: string,
    clients: T[],
  ): Promise<T[]> {
    const trusted: T[] = [];
    for (const client of clients) {
      const joinKey = await this.joinKey(client.id);
      if (
        joinKey != null &&
        (await this.seals.checkClientSeal(client.seal, joinKey, client.id, mspId))
      ) {
        trusted.push(client);
      }
    }
    return trusted;
  }

  /**
   * The seal for a joining setting with these domains, from this source (the
   * organization's own setting, or a default it follows), sealed now or just
   * after the newest seal this device has seen for the organization. Without
   * the organization's key, none: joins then wait for approval. Once the
   * server has taken it, `remember` it.
   */
  async joiningSeal(
    organizationId: string,
    autoConfirm: boolean,
    domains: readonly string[],
    source: JoiningSource,
  ): Promise<string | undefined> {
    const joinKey = await this.joinKey(organizationId);
    if (joinKey == null) {
      return undefined;
    }
    const sealedAt = await this.memory.sealedAt(await this.userId(), organizationId);
    return this.seals.joiningSeal(joinKey, organizationId, autoConfirm, domains, source, sealedAt);
  }

  /**
   * Remembers joining seals this browser made, by organization, once the
   * server took them, so it never goes back to an older setting there.
   */
  async remember(seals: Record<string, string | null | undefined>): Promise<void> {
    const userId = await this.userId();
    for (const [organizationId, seal] of Object.entries(seals)) {
      if (seal != null) {
        await this.memory.remember(userId, organizationId, seal);
      }
    }
  }

  /**
   * The seal for a new joining setting from this source, keeping the email
   * domains only if the current seal vouches for them: the person changing
   * the setting isn't looking at the domains, and the server could have
   * changed them.
   */
  async resealJoining(
    organizationId: string,
    autoConfirm: boolean,
    current: ReportedJoining,
    source: JoiningSource,
  ): Promise<string | undefined> {
    const domains = (await this.vouches(organizationId, current)) ? current.domains : [];
    return this.joiningSeal(organizationId, autoConfirm, domains, source);
  }

  /**
   * The seal for new email domains, keeping "let people in", and where the
   * setting comes from, only if the current seal vouches for them. Otherwise
   * approval, as the organization's own setting, until an admin saves it.
   */
  async sealDomains(
    organizationId: string,
    domains: string[],
    current: ReportedJoining,
  ): Promise<string | undefined> {
    const vouched = await this.vouches(organizationId, current);
    const autoConfirm = current.autoConfirm && vouched;
    const source = (vouched ? joiningSealSource(current.seal) : null) ?? "own";
    return this.joiningSeal(organizationId, autoConfirm, domains, source);
  }

  /**
   * Whether the reported setting, domains included, is what its seal says,
   * with `source`, that the seal says it comes from there, and that it isn't
   * older than the newest seal this device has seen for the organization
   * (a newer one that checks out becomes the newest).
   */
  async vouches(
    organizationId: string,
    current: ReportedJoining,
    source?: JoiningSource,
  ): Promise<boolean> {
    const joinKey = await this.joinKey(organizationId);
    if (joinKey == null) {
      return false;
    }
    return this.memory.vouches(await this.userId(), organizationId, joinKey, current, source);
  }

  /** A new join secret for an install command, encrypted with the organization's key. */
  async newSecret(organizationId: string): Promise<string | undefined> {
    const key = await this.orgKey(organizationId);
    if (key == null) {
      return undefined;
    }
    return (await this.encryptService.encryptString(this.seals.newJoinSecret(), key))
      .encryptedString;
  }

  /**
   * What the install command carries besides the token: the join secret, and
   * the fingerprint of the organization's public key, made from its private
   * key (never from the public key the server sends). Null without the key or
   * a secret. With them, the organization's fingerprint phrase from the same
   * key, which the extension shows the people who join, to compare.
   */
  async commandParts(
    organizationId: string,
    encryptedSecret: string | null | undefined,
  ): Promise<{ secret: string; fingerprint: string; phrase: string[] } | null> {
    const key = await this.orgKey(organizationId);
    if (key == null || encryptedSecret == null) {
      return null;
    }
    try {
      const secret = await this.encryptService.decryptString(new EncString(encryptedSecret), key);
      const { encryptedPrivateKey } = await this.apiService.send(
        "GET",
        `/keykeeper/organizations/${organizationId}/private-key`,
        null,
        true,
        true,
      );
      const privateKey = await this.encryptService.unwrapDecapsulationKey(
        new EncString(encryptedPrivateKey),
        key,
      );
      const publicKey = await this.cryptoFunctionService.rsaExtractPublicKey(privateKey);
      return {
        secret,
        fingerprint: await this.seals.fingerprint(publicKey),
        phrase: await this.legacyCompatKeyService.getFingerprint(organizationId, publicKey),
      };
    } catch {
      return null;
    }
  }
}
