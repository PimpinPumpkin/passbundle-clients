// Keykeeper: who an owner's or admin's app may let in on its own, without
// trusting the server, and how many a day. The server says who is waiting and
// with which public key; an app encrypts the organization's key to that key
// only when something the server can't forge vouches for the person. See
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

import { KeykeeperJoinSeals } from "./join-seals";
import { PendingMember } from "./msp-types";

/** At most this many people a day per organization, on one device; past it, an admin confirms. */
export const MAX_ON_ITS_OWN_PER_DAY = 20;

type Counts = Record<string, { day: string; count: number }>;

const LET_IN_TODAY = new UserKeyDefinition<Counts>(KEYKEEPER_JOINS_DISK, "letInToday", {
  deserializer: (counts) => counts ?? {},
  clearOn: ["logout"],
});

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

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
   * public key.
   */
  async vouchedFor(p: PendingMember, organizationKey: SymmetricCryptoKey): Promise<boolean> {
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
      return this.seals.checkStaffSeal(p.staffSeal, joinKey, p.organizationId, p.email);
    }
    if (await this.seals.checkInviteSeal(p.inviteSeal, joinKey, p.organizationId, p.email)) {
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
    const day = dayOf(now);
    const letIn: PendingMember[] = [];
    for (const p of pending) {
      const key = organizationKeys[p.organizationId as OrganizationId];
      // Not someone who must turn on two-step login first: confirming them would
      // fail, and count against the day's limit for nothing.
      if (
        p.needsTwoStep ||
        !p.autoConfirm ||
        key == null ||
        !(await this.vouchedFor(p, key).catch(() => false))
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
}
