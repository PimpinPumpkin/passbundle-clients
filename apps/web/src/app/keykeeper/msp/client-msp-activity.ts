// Keykeeper: who on a client's Members page sees what its MSP did there
// (DESIGN.md, "The client sees its MSP's actions"): the organization's own
// owners and admins. Not its MSP's people, who have Activity in their
// console, and not a custom role or a member, whom the server refuses.

/** What the page knows about the person looking at it. */
export type Viewer = {
  isOwner: boolean;
  isAdmin: boolean;
  organizationUserId: string;
  /** Their membership came from the organization's MSP (the server says so in sync). */
  keykeeperFromMsp?: boolean;
};

/**
 * Whether to show the MSP's activity: an owner or admin there whose place is
 * the client's own. `staffMemberIds` are the MSP's memberships in the
 * organization, from the banner's list, for a server that doesn't say in sync.
 */
export function seesMspActivity(viewer: Viewer, staffMemberIds: string[]): boolean {
  return (
    (viewer.isOwner || viewer.isAdmin) &&
    viewer.keykeeperFromMsp !== true &&
    !staffMemberIds.includes(viewer.organizationUserId)
  );
}
