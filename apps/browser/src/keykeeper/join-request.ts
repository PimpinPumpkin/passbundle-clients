// Keykeeper: the question the install command's join asks, as the background
// stores it for the prompt page and reads the answer back. See enrollment.ts.

/** The question waiting for the person, and their answer, in session storage. */
export const JOIN_REQUEST_KEY = "keykeeper.joinRequest";
export const JOIN_ANSWER_KEY = "keykeeper.joinAnswer";

/** What the prompt shows. */
export type JoinRequest = {
  organizationName: string;
  accountRecovery: boolean;
  /**
   * The organization has "Members' own passwords" on: its admins will see how
   * many of the person's own passwords are weak, reused, or exposed. Older
   * servers leave it out.
   */
  memberHealth?: boolean;
  /** The organization's fingerprint phrase, when it has a public key. */
  fingerprint: string[] | null;
  /** Organizations where the person is an owner or admin, which account recovery would reach too. */
  adminElsewhere: string[];
};

/** A question as stored for the prompt page. */
export type StoredJoinRequest = JoinRequest & { id: string; userId: string; tokenHash: string };

export type JoinAnswer = { id: string; join: boolean };
