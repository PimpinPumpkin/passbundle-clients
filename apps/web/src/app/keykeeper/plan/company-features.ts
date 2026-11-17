// Keykeeper: whether an organization has the company features (DESIGN.md,
// "Plans and billing", "What a plan is"): policies, account recovery, the
// install command, provisioning, single sign-on, custom roles, groups, the
// event log, events to security tools, and the Access page. A family has
// none of them, and the server says so by turning them off together in the
// sync ("How a plan reaches the clients": usePolicies, useGroups, useEvents,
// useSso, useScim, useResetPassword, useCustomPermissions, useApi), so the
// admin console hides each. Upstream's pages read their own field; ours read
// this. Nothing here decides what a plan gives: the server does, and it
// refuses each feature to a family on its own.
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";

/**
 * Whether the organization has the company features. The server turns them
 * off together, and `usePolicies` is the one of them that's on for every
 * other organization: `useEvents` follows the server's event log setting and
 * `useScim` is upstream's SCIM, which this server doesn't have.
 */
export function hasCompanyFeatures(organization: Organization): boolean {
  return organization.usePolicies === true;
}
