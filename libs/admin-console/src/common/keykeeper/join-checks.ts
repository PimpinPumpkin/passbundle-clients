// Keykeeper: who an owner's or admin's app may let in on its own, without
// trusting the server, and how many a day. The server says who is waiting and
// with which public key; an app encrypts the organization's key to that key
// only when something the server can't forge vouches for the person, and lets
// someone in on an invitation's or staff member's seal only once. Also which
// of the organizations the server calls an MSP's clients really are. See
// DESIGN.md, "Joins a hacked server can't forge".

import { firstValueFrom } from "rxjs";

import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import {
  KEYKEEPER_JOINS_DISK,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperJoinSeals, parseExpiringSeal } from "./join-seals";
import { PendingMember } from "./msp-types";

/** At most this many people a day per organization, on one device; past it, an admin confirms. */
export const MAX_ON_ITS_OWN_PER_DAY = 20;

type Counts = Record<string, { day: string; count: number }>;

const LET_IN_TODAY = new UserKeyDefinition<Counts>(KEYKEEPER_JOINS_DISK, "letInToday", {
  deserializer: (counts) => counts ?? {},
  clearOn: ["logout"],
});

/**
 * The seals this device let someone in on, by organization and nonce, with
 * when each ends, so it never lets anyone in twice on one seal, whatever the
 * server says later. Kept past sign-out; forgotten once a seal has ended.
 */
export const KEYKEEPER_USED_SEALS = new UserKeyDefinition<Record<string, number>>(
  KEYKEEPER_JOINS_DISK,
  "usedSeals",
  {
    deserializer: (used) => used ?? {},
    clearOn: [],
  },
);

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

const fromB64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export class KeykeeperJoinChecks {
  constructor(
    private readonly keyService: KeyService,
    private readonly encryptService: EncryptService,
    private readonly stateProvider: StateProvider,
    private readonly seals = new KeykeeperJoinSeals(),
  ) {}

  /**
   * Whether something the server can't forge vouches for letting this person
   * in: the organization's joining setting must be sealed, with approval off,
   * and then a staff seal for MSP staff, an invitation's seal, or, for an
   * install command join with email domains set, a proof bound to this
   * public key. Invitation and staff seals vouch only until they end.
   */
  async vouchedFor(
    p: PendingMember,
    organizationKey: SymmetricCryptoKey,
    now: Date = new Date(),
  ): Promise<boolean> {
    const joining = p.joining;
    if (joining == null || !joining.autoConfirm) {
      return false;
    }
    const joinKey = await this.seals.joinKey(organizationKey.toEncoded());
    if (
      !(await this.seals.checkJoiningSeal(
        joining.seal,
        joinKey,
        p.organizationId,
        true,
        joining.domains,
      ))
    ) {
      return false;
    }
    if (p.fromMsp) {
      return this.seals.checkStaffSeal(p.staffSeal, joinKey, p.organizationId, p.email, now);
    }
    if (await this.seals.checkInviteSeal(p.inviteSeal, joinKey, p.organizationId, p.email, now)) {
      return true;
    }
    if (p.joinProof == null || p.enrollmentSecret == null || joining.domains.length === 0) {
      return false;
    }
    const secret = await this.encryptService.decryptString(
      new EncString(p.enrollmentSecret),
      organizationKey,
    );
    return this.seals.checkJoinProof(
      p.joinProof,
      secret,
      p.organizationId,
      p.userId,
      fromB64(p.publicKey),
    );
  }

  /**
   * Those waiting whom this device may let in on its own now, within today's
   * limit for each organization. The rest wait for an owner or admin, or, if
   * they must turn on two-step login first, for themselves.
   */
  async onItsOwn(
    userId: UserId,
    pending: PendingMember[],
    now: Date = new Date(),
  ): Promise<PendingMember[]> {
    if (pending.length === 0) {
      return [];
    }
    const organizationKeys = (await firstValueFrom(this.keyService.orgKeys$(userId))) ?? {};
    const state = this.stateProvider.getUser(userId, LET_IN_TODAY);
    const counts: Counts = { ...((await firstValueFrom(state.state$)) ?? {}) };
    const used =
      (await firstValueFrom(this.stateProvider.getUser(userId, KEYKEEPER_USED_SEALS).state$)) ?? {};
    const day = dayOf(now);
    const letIn: PendingMember[] = [];
    for (const p of pending) {
      const key = organizationKeys[p.organizationId as OrganizationId];
      const seal = sealOf(p);
      // Not someone who must turn on two-step login first: confirming them would
      // fail, and count against the day's limit for nothing.
      if (
        p.needsTwoStep ||
        !p.autoConfirm ||
        key == null ||
        (seal != null && used[usedKey(p, seal.nonce)] != null) ||
        !(await this.vouchedFor(p, key, now).catch(() => false))
      ) {
        continue;
      }
      const count = counts[p.organizationId]?.day === day ? counts[p.organizationId].count : 0;
      if (count >= MAX_ON_ITS_OWN_PER_DAY) {
        continue;
      }
      counts[p.organizationId] = { day, count: count + 1 };
      letIn.push(p);
    }
    if (letIn.length > 0) {
      await state.update(() => counts);
    }
    return letIn;
  }

  /**
   * Remembers the seal someone was let in on, after their confirm went
   * through, so this device never lets anyone in on it again.
   */
  async markLetIn(userId: UserId, p: PendingMember, now: Date = new Date()): Promise<void> {
    const seal = sealOf(p);
    if (seal == null) {
      return;
    }
    await this.stateProvider.getUser(userId, KEYKEEPER_USED_SEALS).update((used) => {
      const kept: Record<string, number> = {};
      for (const [key, expires] of Object.entries(used ?? {})) {
        if (expires > seconds(now)) {
          kept[key] = expires;
        }
      }
      kept[usedKey(p, seal.nonce)] = seal.expires;
      return kept;
    });
  }

  /**
   * Of the organizations the server lists as an MSP's clients, those this
   * person holds the key of and that carry a client seal for this MSP, made
   * by a browser holding the organization's key. Seals, template copies, and
   * the rest of an MSP admin's background work go only to these.
   */
  async trustedClients<T extends { id: string; seal?: string | null }>(
    userId: UserId,
    mspId: string,
    clients: T[],
  ): Promise<T[]> {
    const organizationKeys = (await firstValueFrom(this.keyService.orgKeys$(userId))) ?? {};
    const trusted: T[] = [];
    for (const client of clients) {
      const key = organizationKeys[client.id as OrganizationId];
      if (key == null || client.seal == null) {
        continue;
      }
      const joinKey = await this.seals.joinKey(key.toEncoded());
      if (await this.seals.checkClientSeal(client.seal, joinKey, client.id, mspId)) {
        trusted.push(client);
      }
    }
    return trusted;
  }
}

/** The seal that would let this person in: a staff seal for MSP staff, otherwise an invitation's. */
function sealOf(p: PendingMember) {
  return parseExpiringSeal(p.fromMsp ? p.staffSeal : p.inviteSeal);
}

/** How a used seal is remembered: by organization and nonce. */
const usedKey = (p: PendingMember, nonce: string) => `${p.organizationId}/${nonce}`;
