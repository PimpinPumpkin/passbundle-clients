import { AttachingOff } from "@bitwarden/common/vault/keykeeper/attachments-plan";

/**
 * Keykeeper: what a plan doesn't include, said in the server's own words
 * (DESIGN.md, "Plans and billing", the table of refusals), so the web vault,
 * the extension and the server say the same sentence. The values are message
 * keys in brand/messages.en.json.
 */
export const KeykeeperPlanSentence = {
  /** A Premium feature the server has no sentence of its own for. */
  Premium: "keykeeperPlanPremium",
  AttachFiles: "keykeeperPlanAttachFiles",
  SendFiles: "keykeeperPlanSendFiles",
  BreachReport: "keykeeperPlanBreachReport",
  /** A feature of an organization's that its plan doesn't include. */
  OrganizationPlan: "keykeeperPlanOrganization",
  /** An organization whose plan has ended: nothing new, everything else as before. */
  OrganizationEnded: "keykeeperPlanOrganizationEnded",
} as const;

export type KeykeeperPlanSentence =
  (typeof KeykeeperPlanSentence)[keyof typeof KeykeeperPlanSentence];

/**
 * The website's Pricing page. The brand step writes its address from
 * brand.json (the "keykeeperPricingPage" message), so it's never typed in the
 * code. Anything but an https address is no address: a missing message comes
 * back empty or as its own key, and the link is left out.
 */
export function pricingPageAddress(message: string | null | undefined): string | null {
  return typeof message === "string" && message.startsWith("https://") ? message : null;
}

/** The sentence for an item files can't be added to. */
export function attachingOffSentence(off: AttachingOff): KeykeeperPlanSentence {
  return off === "organization"
    ? KeykeeperPlanSentence.OrganizationEnded
    : KeykeeperPlanSentence.AttachFiles;
}
