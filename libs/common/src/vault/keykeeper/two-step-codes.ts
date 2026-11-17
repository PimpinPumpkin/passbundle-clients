/**
 * Keykeeper: two-step codes need Premium (DESIGN.md, "Plans and billing",
 * decision 2), as in upstream's clients. An item's current code shows, copies,
 * and fills only for someone with Premium, of their own or through an
 * organization or an MSP (`hasPremiumFromAnySource$`), or for an item in an
 * organization that gives codes (`organizationUseTotp`). Without either, the
 * key stays in the item and the edit form still shows and changes it, so
 * nothing is lost and the code comes back with Premium. Where the server
 * doesn't enforce plans, it says everyone has Premium, and every code shows.
 */

/** The sentence shown where a code would be, a message key in brand/messages.en.json. */
export const TWO_STEP_CODES_NEED_PREMIUM = "keykeeperPlanTwoStepCodes";

/**
 * Whether an item's current two-step code may show, be copied, and fill.
 *
 * @param item the item, with whether its organization gives codes
 * @param hasPremium whether the person has Premium from any source
 */
export function showsTwoStepCode(
  item: { organizationUseTotp?: boolean | null },
  hasPremium: boolean,
): boolean {
  return hasPremium || item.organizationUseTotp === true;
}
