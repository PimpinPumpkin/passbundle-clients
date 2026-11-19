// Keykeeper: a family's invite link in the web vault (DESIGN.md, "A family's
// invite link"). The owner's or admin's browser makes the link's token and
// join secret, and keeps the link's settings on the server encrypted with the
// family's key (KeykeeperFamilyLinks), so the server keeps only the token's
// hash and never sees the secret. The joining browser sends the token and a
// proof made with the secret, bound to its own public key, so an owner's or
// admin's app can let them in on its own only when the owner chose automatic.

import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import {
  FAMILY_LINK_DAYS,
  familyLinkAddress,
  FamilyLinkParts,
  FamilyLinkSettings,
  KeykeeperFamilyLinks,
  KeykeeperJoinSeals,
} from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService } from "@bitwarden/legacy-crypto";

/** Someone who joined with the link, as the link's card lists them. */
export type FamilyLinkJoinView = {
  memberId: string;
  email: string;
  name: string | null;
  joinedAt: string;
  /** Whether approval was automatic when they joined. */
  automatic: boolean;
  /** Upstream's membership status: 1 waiting for the family's key, 2 in, -1 revoked. */
  status: number;
};

/** The family's link as the server answers its owners and admins. */
export type FamilyLinkView = {
  on: boolean;
  live: boolean;
  automatic: boolean;
  expiresAt: string | null;
  madeAt: string | null;
  madeBy: string | null;
  collectionId: string | null;
  sealed: string | null;
  joins: FamilyLinkJoinView[];
};

/** The link to show: its address, and its settings, opened with the family's key. */
export type ShownFamilyLink = { address: string; settings: FamilyLinkSettings };

/** What the join page may say before anyone signs in. */
export type FamilyLinkInfo = { organizationName: string; invitedBy: string | null };

export type FamilyJoined = {
  organizationId: string;
  organizationName: string;
  status: number | null;
  automatic: boolean;
};

const DAY_SECONDS = 86_400;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

@Injectable({ providedIn: "root" })
export class KeykeeperFamilyLinkService {
  private readonly seals = new KeykeeperJoinSeals();
  private readonly links: KeykeeperFamilyLinks;

  constructor(
    private readonly apiService: ApiService,
    private readonly accountService: AccountService,
    private readonly keyService: KeyService,
    private readonly environmentService: EnvironmentService,
    encryptService: EncryptService,
    stateProvider: StateProvider,
  ) {
    this.links = new KeykeeperFamilyLinks(encryptService, stateProvider, this.seals);
  }

  private userId(): Promise<UserId> {
    return firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
  }

  /** The family's key, which only its confirmed members hold. */
  private async familyKey(organizationId: string): Promise<OrgKey> {
    const keys = await firstValueFrom(this.keyService.orgKeys$(await this.userId()));
    const key = keys?.[organizationId as OrganizationId];
    if (key == null) {
      throw new Error("This browser doesn't have the family's key yet. Reload and try again.");
    }
    return key;
  }

  private path(organizationId: string) {
    return `/keykeeper/organizations/${organizationId}/family-link`;
  }

  /**
   * The family's link, or null when the server says "not found": the
   * organization isn't a family, or the person isn't one of its owners or
   * admins. The card stays hidden then.
   */
  async get(organizationId: string): Promise<FamilyLinkView | null> {
    try {
      return await this.apiService.send("GET", this.path(organizationId), null, true, true);
    } catch {
      return null;
    }
  }

  /**
   * The link to show, while it works: opened from its sealed settings with
   * the family's key, only if they're current on this device. Null when it's
   * off, ended, or its settings don't open.
   */
  async shown(organizationId: string, view: FamilyLinkView): Promise<ShownFamilyLink | null> {
    if (!view.live || view.sealed == null) {
      return null;
    }
    const settings = await this.current(organizationId, view.sealed);
    if (settings?.token == null || settings.secret == null) {
      return null;
    }
    const environment = await firstValueFrom(this.environmentService.environment$);
    const address = familyLinkAddress(environment.getWebVaultUrl(), {
      organizationId,
      token: settings.token,
      secret: settings.secret,
    });
    return { address, settings };
  }

  /** Settings the server keeps, if they open with the family's key and are current here. */
  private async current(
    organizationId: string,
    sealed: string,
  ): Promise<FamilyLinkSettings | null> {
    const settings = await this.links.open(
      sealed,
      await this.familyKey(organizationId),
      organizationId,
    );
    if (settings == null || !(await this.links.current(await this.userId(), settings))) {
      return null;
    }
    return settings;
  }

  /** Seals settings, sends them with `send`, and remembers them once the server took them. */
  private async save(
    organizationId: string,
    settings: FamilyLinkSettings,
    send: (sealed: string) => Promise<FamilyLinkView>,
  ): Promise<FamilyLinkView> {
    const sealed = await this.links.seal(settings, await this.familyKey(organizationId));
    const view = await send(sealed);
    await this.links.current(await this.userId(), settings);
    return view;
  }

  private async mark(organizationId: string) {
    return {
      sealedAt: await this.links.sealedAt(await this.userId(), organizationId),
      nonce: this.links.newNonce(),
    };
  }

  /**
   * Makes the family's link, or a new one in its place: a new token and join
   * secret, made here. The old link stops working at once.
   */
  async make(
    organizationId: string,
    choice: { automatic: boolean; days: number; collectionId: string | null },
  ): Promise<FamilyLinkView> {
    if (!(FAMILY_LINK_DAYS as readonly number[]).includes(choice.days)) {
      throw new Error("An invite link works for 1, 7, or 30 days.");
    }
    const mark = await this.mark(organizationId);
    const settings: FamilyLinkSettings = {
      v: 1,
      organizationId,
      on: true,
      token: this.links.newRandom(),
      secret: this.links.newRandom(),
      automatic: choice.automatic,
      expiresAt: seconds(new Date()) + choice.days * DAY_SECONDS,
      ...mark,
    };
    return this.save(organizationId, settings, (sealed) =>
      this.apiService.send(
        "PUT",
        this.path(organizationId),
        {
          token: settings.token,
          sealed,
          automatic: choice.automatic,
          days: choice.days,
          collectionId: choice.collectionId,
        },
        true,
        true,
      ),
    );
  }

  /**
   * One tap or automatic, for the link that's on: the same link, sealed
   * again with the new approval. Only from settings that open and are current
   * here, so a change never builds on older ones the server shows again.
   */
  async setApproval(
    organizationId: string,
    view: FamilyLinkView,
    automatic: boolean,
  ): Promise<FamilyLinkView> {
    const now = view.sealed == null ? null : await this.current(organizationId, view.sealed);
    if (now == null || !now.on) {
      throw new Error("This link's settings can't be checked here. Make a new link instead.");
    }
    const settings: FamilyLinkSettings = {
      ...now,
      automatic,
      ...(await this.mark(organizationId)),
    };
    return this.save(organizationId, settings, (sealed) =>
      this.apiService.send(
        "PUT",
        `${this.path(organizationId)}/approval`,
        { automatic, sealed },
        true,
        true,
      ),
    );
  }

  /** Turns the link off: settings that say so, with no token or secret. */
  async turnOff(organizationId: string): Promise<FamilyLinkView> {
    const settings: FamilyLinkSettings = {
      v: 1,
      organizationId,
      on: false,
      token: null,
      secret: null,
      automatic: false,
      expiresAt: null,
      ...(await this.mark(organizationId)),
    };
    return this.save(organizationId, settings, (sealed) =>
      this.apiService.send("DELETE", this.path(organizationId), { sealed }, true, true),
    );
  }

  /** The family's name and who made the link, or null for every link that doesn't work. */
  async info(parts: FamilyLinkParts): Promise<FamilyLinkInfo | null> {
    try {
      return await this.apiService.send(
        "POST",
        "/keykeeper/family-link/info",
        { organizationId: parts.organizationId, token: parts.token },
        false,
        true,
      );
    } catch {
      return null;
    }
  }

  /**
   * Joins with the link, as a member waiting for the family's key, with the
   * proof that this browser knew the join secret, bound to the public key it
   * derives from this account's own private key. The secret stays here.
   */
  async join(parts: FamilyLinkParts): Promise<FamilyJoined> {
    const userId = await this.userId();
    const publicKey = await firstValueFrom(this.keyService.userPublicKey$(userId));
    const proof =
      publicKey == null
        ? null
        : await this.seals.joinProof(parts.secret, parts.organizationId, userId, publicKey);
    return this.apiService.send(
      "POST",
      "/keykeeper/family-link/join",
      { organizationId: parts.organizationId, token: parts.token, proof },
      true,
      true,
    );
  }

  /** Whether to suggest a legacy contact; false when the server can't be asked. */
  async legacyContactSuggestion(): Promise<boolean> {
    try {
      const answer = await this.apiService.send(
        "GET",
        "/keykeeper/legacy-contact-suggestion",
        null,
        true,
        true,
      );
      return answer?.show === true;
    } catch {
      return false;
    }
  }

  async dismissLegacyContactSuggestion(): Promise<void> {
    await this.apiService.send(
      "POST",
      "/keykeeper/legacy-contact-suggestion/dismiss",
      null,
      true,
      true,
    );
  }
}
