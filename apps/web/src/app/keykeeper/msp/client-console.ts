import { canAccessOrgAdmin } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";

import { MspClient } from "./msp-api.service";

/**
 * Keykeeper: what the MSP console offers for a client someone is confirmed
 * in. Their way into its admin console when their role there opens it, by
 * upstream's own rule (canAccessOrgAdmin), since the admin console refuses
 * anyone else; otherwise their items in their own vault, when they see
 * them, or a plain word. A client not synced yet keeps the admin console:
 * its own guard decides.
 */
export function clientConsoleWay(
  client: MspClient,
  organization: Organization | undefined,
): "admin-console" | "items" | "none" {
  if (organization == null || canAccessOrgAdmin(organization)) {
    return "admin-console";
  }
  return client.you?.vaultItems !== false ? "items" : "none";
}

/** Why a client has no Admin console link, and what to do. */
export function noConsoleHelp(client: MspClient): string {
  return client.you?.vaultItems !== false
    ? `Your role in ${client.name} doesn't include its admin console. Its items are in your vault.`
    : `Your role in ${client.name} doesn't include its admin console or its items. An MSP admin can change your access.`;
}
