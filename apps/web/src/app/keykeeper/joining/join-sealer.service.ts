import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { KeykeeperJoinSeals } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { CryptoFunctionService } from "@bitwarden/common/key-management/crypto/abstractions/crypto-function.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

/** An organization's joining setting as the server reports it, with its seal. */
export type ReportedJoining = { autoConfirm: boolean; domains: string[]; seal: string | null };

/**
 * Keykeeper: the seals and join secrets an owner's or admin's browser makes
 * when they invite someone, change how people join, or make an install
 * command, so other apps can let people in on their own without trusting
 * the server. Made only on these actions, never from what the server lists
 * on its own. See DESIGN.md, "Joins a hacked server can't forge".
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
  ) {}

  /** The organization's key, if this person holds it. */
  private async orgKey(organizationId: string): Promise<OrgKey | null> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const keys = await firstValueFrom(this.keyService.orgKeys$(userId));
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

  /**
   * The seal for a joining setting with these domains. Without the
   * organization's key, none: joins then wait for approval.
   */
  async joiningSeal(
    organizationId: string,
    autoConfirm: boolean,
    domains: string[],
  ): Promise<string | undefined> {
    const joinKey = await this.joinKey(organizationId);
    return joinKey == null
      ? undefined
      : this.seals.joiningSeal(joinKey, organizationId, autoConfirm, domains);
  }

  /**
   * The seal for a new joining setting, keeping the email domains only if the
   * current seal vouches for them: the person changing the setting isn't
   * looking at the domains, and the server could have changed them.
   */
  async resealJoining(
    organizationId: string,
    autoConfirm: boolean,
    current: ReportedJoining,
  ): Promise<string | undefined> {
    const domains = (await this.vouches(organizationId, current)) ? current.domains : [];
    return this.joiningSeal(organizationId, autoConfirm, domains);
  }

  /**
   * The seal for new email domains, keeping "let people in" only if the
   * current seal vouches for it. Otherwise approval, until an admin saves
   * the setting.
   */
  async sealDomains(
    organizationId: string,
    domains: string[],
    current: ReportedJoining,
  ): Promise<string | undefined> {
    const autoConfirm = current.autoConfirm && (await this.vouches(organizationId, current));
    return this.joiningSeal(organizationId, autoConfirm, domains);
  }

  private async vouches(organizationId: string, current: ReportedJoining): Promise<boolean> {
    const joinKey = await this.joinKey(organizationId);
    if (joinKey == null) {
      return false;
    }
    return this.seals.checkJoiningSeal(
      current.seal,
      joinKey,
      organizationId,
      current.autoConfirm,
      current.domains,
    );
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
   * a secret.
   */
  async commandParts(
    organizationId: string,
    encryptedSecret: string | null | undefined,
  ): Promise<{ secret: string; fingerprint: string } | null> {
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
      return { secret, fingerprint: await this.seals.fingerprint(publicKey) };
    } catch {
      return null;
    }
  }
}
