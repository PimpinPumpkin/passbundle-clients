/**
 * Keykeeper: whether files can be added to an item, by plan (DESIGN.md,
 * "Plans and billing"). Attaching is Premium's on a personal item, and an
 * organization's while its plan is in effect: the server reports the plan's
 * storage as `maxStorageGb`, and 0 once the plan has ended. Downloading and
 * removing never look at a plan, so this is only ever about adding.
 */

/** Why files can't be added: the person has no Premium, or the organization has no storage. */
export type AttachingOff = "premium" | "organization";

/**
 * Why files can't be added to an item, or null when they can.
 *
 * @param organizationId the item's organization, empty for a personal item
 * @param organization that organization as the person's sync has it, when it has it
 * @param hasPremium whether the person has Premium from any source
 */
export function attachingOff(
  organizationId: string | null | undefined,
  organization: { maxStorageGb?: number | null } | null | undefined,
  hasPremium: boolean,
): AttachingOff | null {
  if (!organizationId) {
    return hasPremium ? null : "premium";
  }
  // An organization the person isn't in can't be checked here: the server decides.
  if (organization == null) {
    return null;
  }
  return organization.maxStorageGb ? null : "organization";
}

/**
 * Whether the attachments window has anything to offer: it opens for any item
 * that has files, on any plan, so a file can be downloaded and removed, and
 * for any item files can be added to. An item with no files and no right to
 * add gets the plain sentence instead.
 */
export function attachmentsWindowOpens(hasFiles: boolean, off: AttachingOff | null): boolean {
  return hasFiles || off == null;
}
