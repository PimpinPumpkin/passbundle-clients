// Keykeeper: sentences for the MSP audit log in the console.

export type MspEvent = {
  id: string;
  date: string;
  event: string;
  actorEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  targetEmail: string | null;
  detail: string | null;
  ip: string | null;
};

const roleName = (role: string | null) => (role === "admin" ? "an admin" : "a technician");

/**
 * What happened, in one sentence. Template events record only the template's
 * id (the server never sees its name), so `templateName` supplies the names
 * the person can see.
 */
export function describeEvent(
  e: MspEvent,
  templateName: (templateId: string) => string | undefined = () => undefined,
): string {
  const actor = e.actorEmail ?? "Someone";
  const org = e.organizationName || "a client";
  const target = e.targetEmail ?? "someone";
  // Template details are "<template id>:<clients>", or just the id.
  const detail = e.detail ?? "";
  const colon = detail.indexOf(":");
  const templateId = colon < 0 ? detail : detail.slice(0, colon);
  const clients = colon < 0 ? "" : detail.slice(colon + 1);
  const name = templateName(templateId);
  const theTemplate = name ? `the template ${name}` : "a template";
  switch (e.event) {
    case "msp_created":
      return `${actor} set up ${e.detail ?? "the MSP"}`;
    case "client_created":
      // Clients added before default policies started with "Business defaults".
      return `${actor} added the client ${org}${e.detail === "Default policies" || e.detail === "Business defaults" ? " with the default policies" : ""}`;
    case "default_policy_changed":
      return `${actor} set the default ${e.detail ?? "policy"}`;
    case "template_added":
      return `${actor} added ${theTemplate} for ${clients || "clients"}`;
    case "template_changed":
      return `${actor} changed which clients get ${name ?? "a template"}: ${clients || "clients"}`;
    case "template_sent":
      // Copies written when a template is added, a client is added, or the template changes.
      return `${name ?? "A template"} was applied to ${e.organizationName || clients || "clients"} (by ${actor})`;
    case "template_stopped":
      return `${actor} removed ${theTemplate}`;
    case "client_policy_default":
      return `${actor} put ${org} back on the default ${e.detail ?? "policy"}`;
    case "joining_default_set":
      return `${actor} set how people join clients: ${e.detail ?? "updated"}`;
    case "client_joining_set":
      return `${actor} set how people join ${org}: ${e.detail ?? "updated"}`;
    case "client_joining_default":
      return `${actor} put ${org} back on the joining default`;
    case "staff_added":
      return `${actor} added ${target} as ${roleName(e.detail)}`;
    case "staff_invited":
      return `${actor} invited ${target} to join as ${roleName(e.detail)}`;
    case "staff_invite_accepted":
      return `${target} accepted the invitation and joined as ${roleName(e.detail)}`;
    case "staff_invite_cancelled":
      return `${actor} cancelled the invitation for ${target}`;
    case "staff_role_changed":
      return `${actor} made ${target} ${roleName(e.detail)}`;
    case "staff_access_changed":
      return `${actor} set ${target}'s access: ${e.detail ?? "changed"}`;
    case "staff_removed":
      return `${actor} removed ${target} from the MSP and every client`;
    case "install_token_replaced":
      return `${actor} replaced the install token for ${org}`;
    case "joined_with_install_command":
      return `${target} joined ${org} with the install command`;
    case "site_rule_added":
      return `${actor} applied a site fix to every client: ${e.detail ?? ""}`.trim();
    case "site_rule_removed":
      return `${actor} removed a site fix: ${e.detail ?? ""}`.trim();
    case "install_domains_set":
      return e.detail
        ? `${actor} limited ${org}'s install command to ${e.detail.split(" ").join(", ")} accounts`
        : `${actor} let anyone with ${org}'s install command join`;
    case "member_confirmed":
      return `${actor} confirmed ${target} in ${org}`;
    case "client_removed_msp":
      return `${org} removed this MSP (${actor})`;
    case "script_token_created": {
      // "<token name>: <n> items"
      const split = detail.lastIndexOf(": ");
      return split < 0
        ? `${actor} made a script token for ${org}`
        : `${actor} made the script token "${detail.slice(0, split)}" for ${org} (${detail.slice(split + 2)})`;
    }
    case "script_token_revoked":
      return `${actor} revoked the script token "${detail}" for ${org}`;
    case "script_token_new_address":
      return `The script token "${detail}" for ${org} was used from a new address, ${e.ip ?? "unknown"}`;
    // Provisioning from Microsoft Entra ID (DESIGN.md, "Provisioning from Entra ID").
    case "provisioning_token_created":
      return `${actor} made a provisioning token for ${org}`;
    case "provisioning_token_replaced":
      return `${actor} replaced ${org}'s provisioning token`;
    case "provisioning_token_revoked":
      return `${actor} revoked ${org}'s provisioning token`;
    case "provisioning_let_in":
      return `${actor} let in ${detail} Microsoft Entra ID added to ${org}`;
    // Single sign-on with Microsoft Entra ID (DESIGN.md, "Sign in with Microsoft Entra ID").
    case "sso_turned_on":
      return `${actor} turned on single sign-on for ${org}`;
    case "sso_turned_off":
      return `${actor} turned off single sign-on for ${org}`;
    case "sso_settings_changed":
      return `${actor} changed ${org}'s single sign-on settings (${detail || "settings"})`;
    case "sso_domain_added":
      return `${actor} added the domain ${detail} to ${org}'s single sign-on`;
    case "sso_domain_verified":
      return `${actor} verified the domain ${detail} for ${org}`;
    case "sso_domain_removed":
      return `${actor} removed the domain ${detail} from ${org}'s single sign-on`;
    case "sso_api_keys_replaced":
      return `${actor} replaced the API keys of ${detail === "1" ? "1 member" : `${detail || "the"} members`} who must use ${org}'s single sign-on`;
    case "sso_unlinked":
      return `${actor} unlinked ${target}'s single sign-on in ${org}`;
    default:
      return `${e.event} by ${actor}`;
  }
}
