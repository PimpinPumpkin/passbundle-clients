// Keykeeper: the newest joining seal this device has seen for each
// organization, so a hacked server can't show it an older setting again,
// such as "let people in" after the organization chose approval, email
// domains it has since removed, or "follows the default" after a client chose
// its own setting. A joining seal (version 3) says when it was sealed, inside
// its MAC; a device takes one only if it isn't older than the newest it has
// seen there, and seals a change just after that. A device that never saw
// the newer setting can still be shown the older one: see DESIGN.md, "Joins a
// hacked server can't forge", version 3 joining seals.

import { firstValueFrom } from "rxjs";

import {
  KEYKEEPER_JOINS_DISK,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { UserId } from "@bitwarden/common/types/guid";

import {
  compareJoiningMarks,
  JoiningMark,
  JoiningSource,
  joiningSealedAt,
  KeykeeperJoinSeals,
  parseJoiningSeal,
} from "./join-seals";

/**
 * The newest joining seal this device has seen for each organization, by
 * organization id: one whose MAC checked out, or one it made that the server
 * took. Kept past sign-out, like the seals it let people in on.
 */
export const KEYKEEPER_JOINING_SEEN = new UserKeyDefinition<Record<string, JoiningMark>>(
  KEYKEEPER_JOINS_DISK,
  "joiningSeen",
  {
    deserializer: (seen) => seen ?? {},
    clearOn: [],
  },
);

/** An organization's joining setting as the server reports it, with its seal. */
export type ReportedJoining = {
  autoConfirm: boolean;
  domains: readonly string[];
  seal: string | null | undefined;
};

export class KeykeeperJoiningMemory {
  constructor(
    private readonly stateProvider: StateProvider,
    private readonly seals = new KeykeeperJoinSeals(),
  ) {}

  /**
   * Whether the reported setting's seal vouches for it (its setting, its
   * domains, and, with `source`, that it comes from there) and is current on
   * this device: not older than the newest joining seal it has seen for this
   * organization. A seal whose MAC checks out and that's newer becomes the
   * newest, whatever `source` asks, so a device learns from every seal it
   * checks.
   */
  async vouches(
    userId: UserId,
    organizationId: string,
    joinKey: Uint8Array,
    reported: ReportedJoining,
    source?: JoiningSource,
  ): Promise<boolean> {
    const parts = parseJoiningSeal(reported.seal);
    if (
      parts == null ||
      !(await this.seals.checkJoiningSeal(
        reported.seal,
        joinKey,
        organizationId,
        reported.autoConfirm,
        reported.domains,
      ))
    ) {
      return false;
    }
    const current = await this.see(userId, organizationId, parts);
    return current && (source == null || parts.source === source);
  }

  /**
   * Remembers a joining seal this device made, once the server took it, so
   * this device never goes back to anything older.
   */
  async remember(userId: UserId, organizationId: string, seal: string): Promise<void> {
    const parts = parseJoiningSeal(seal);
    if (parts != null) {
      await this.see(userId, organizationId, parts);
    }
  }

  /** When to seal a change for this organization: now, or just after the newest seal seen. */
  async sealedAt(userId: UserId, organizationId: string, now: Date = new Date()): Promise<number> {
    return joiningSealedAt(now, (await this.newest(userId))[organizationId]?.sealedAt);
  }

  /** The newest joining seal seen for each organization. */
  async newest(userId: UserId): Promise<Record<string, JoiningMark>> {
    return (
      (await firstValueFrom(this.stateProvider.getUser(userId, KEYKEEPER_JOINING_SEEN).state$)) ??
      {}
    );
  }

  /**
   * Records `mark` as the newest for this organization if it's newer than
   * what's there, and says whether it's current: not older than the newest.
   */
  private async see(userId: UserId, organizationId: string, mark: JoiningMark): Promise<boolean> {
    const newer = (seen: Record<string, JoiningMark> | null) => {
      const newest = seen?.[organizationId];
      return newest == null || compareJoiningMarks(mark, newest) > 0;
    };
    const after = await this.stateProvider.getUser(userId, KEYKEEPER_JOINING_SEEN).update(
      (seen) => ({
        ...(seen ?? {}),
        [organizationId]: { sealedAt: mark.sealedAt, nonce: mark.nonce },
      }),
      { shouldUpdate: newer },
    );
    const newest = after?.[organizationId];
    return newest != null && compareJoiningMarks(mark, newest) >= 0;
  }
}
