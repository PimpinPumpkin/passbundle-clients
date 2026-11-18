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

/** A confirm's detail when the app that made it did it on its own. */
const AUTOMATIC = "automatic";

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
    // Two-step login for admins is a default too, logged as a security setting.
    case "default_policy_changed":
    case "admin_two_step_default_set":
      return `${actor} set the default ${e.detail ?? "policy"}`;
    case "staff_two_step_set":
      return detail === "off"
        ? `${actor} stopped requiring two-step login of the MSP's staff`
        : `${actor} required two-step login of the MSP's staff`;
    case "client_admin_two_step_set":
      return detail === "off"
        ? `${actor} stopped requiring two-step login of ${org}'s admins`
        : `${actor} required two-step login of ${org}'s admins`;
    case "client_browser_autofill_set":
      return detail === "unchanged"
        ? `${actor} left the browsers' card and address autofill as they are in ${org}`
        : detail === "offAndImport"
          ? `${actor} turned off the browsers' card and address autofill in ${org}, offering to bring them in`
          : `${actor} turned off the browsers' card and address autofill in ${org}`;
    case "client_password_change_set":
      return detail === "off"
        ? `${actor} turned off assisted password change in ${org}`
        : `${actor} turned on assisted password change in ${org}`;
    case "client_everyone_two_step_set":
      return detail === "off"
        ? `${actor} stopped requiring two-step login of everyone in ${org}`
        : `${actor} required two-step login of everyone in ${org}`;
    // Members' own passwords, changed in the client's own settings.
    case "client_member_health_set":
      return detail === "off"
        ? `${actor} turned off Members' own passwords in ${org}`
        : `${actor} turned on Members' own passwords in ${org}`;
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
    // A default required for every client (DESIGN.md, "Required for every client").
    case "default_policy_required":
      return `${actor} required ${e.detail ?? "a policy for every client"}`;
    case "default_policy_unrequired":
      return `${actor} stopped requiring ${e.detail ?? "a policy for every client"}`;
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
      return `${actor} canceled the invitation for ${target}`;
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
    // Keykeeper: confirmed by an app on its own, as the console and the
    // background work do: nobody compared fingerprints (DESIGN.md, "Key
    // fingerprints").
    case "member_confirmed":
      return e.detail === AUTOMATIC
        ? `${actor} confirmed ${target} in ${org} automatically, without comparing fingerprints`
        : `${actor} confirmed ${target} in ${org}`;
    case "client_removed_msp":
      return `${org} removed this MSP (${actor})`;
    // Keykeeper: the client took one of the MSP's people out itself; they stay
    // out (DESIGN.md, "Offboarding"). No actor means the client's directory.
    case "client_removed_staff":
      return `${org} removed ${target} (${e.actorEmail ?? "its directory"}); they stay out until ${org} invites them again`;
    case "client_revoked_staff":
      return `${org} revoked ${target} (${e.actorEmail ?? "its directory"}); they stay out until ${org} restores them`;
    case "templates_collection_set":
      return `${actor} set ${org}'s Templates folder`;
    case "templates_collection_gone":
      return `${org} deleted its Templates folder; the next template sent there makes a new one`;
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
    case "event_stream_added":
      return `${actor} started sending the MSP's events to ${detail || "a destination"}`;
    case "event_stream_changed":
      return `${actor} changed where the MSP's events go: ${detail || "a destination"}`;
    case "event_stream_removed":
      return `${actor} stopped sending the MSP's events to ${detail || "a destination"}`;
    case "event_stream_paused":
      return `The server stopped sending the MSP's events to ${detail || "a destination"}`;
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
      // A newer server's, which this page has no sentence for yet: readable
      // anyway, never the bare code.
      return `${readableCode(e.event)}${e.organizationName ? ` in ${e.organizationName}` : ""} (by ${actor})`;
  }
}

/** An event's code as words: "client_seat_report" is "Client seat report". */
function readableCode(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim();
  return words === "" ? "Something changed" : words[0].toUpperCase() + words.slice(1);
}

/**
 * One of the MSP's entries as a client's own owners and admins see it on
 * their Members page (GET /keykeeper/organizations/<id>/msp/activity): only
 * entries about their organization, without where each came from.
 */
export type ClientMspEvent = {
  id: string;
  date: string;
  event: string;
  actorEmail: string | null;
  targetEmail: string | null;
  detail: string | null;
};

/** A role in the client, as the server records it for the MSP's people there. */
function clientRole(detail: string | null): string {
  switch (detail) {
    case "owner":
      return "as an owner";
    case "admin":
      return "as an admin";
    case "custom items":
      return "with a custom role that sees every item";
    default:
      return "with a custom role";
  }
}

/**
 * What the MSP did in the client's organization, in one sentence for its own
 * people: "your organization" rather than its name, and the MSP by name.
 * Template entries record only the template's id (the server never sees its
 * name), so they say "a template".
 */
export function describeClientEvent(e: ClientMspEvent, mspName: string): string {
  const actor = e.actorEmail ?? "Someone";
  const target = e.targetEmail ?? "someone";
  switch (e.event) {
    case "client_created":
      return `${actor} set up your organization as a client of ${mspName}${e.detail === "Default policies" || e.detail === "Business defaults" ? ", with its default policies" : ""}`;
    case "client_staff_added":
      return `${actor} added ${target} to your organization ${clientRole(e.detail)}`;
    case "client_staff_role_changed":
      return `${actor} changed ${target}'s role in your organization: now ${clientRole(e.detail)}`;
    case "client_staff_removed":
      return `${actor} removed ${target} from your organization`;
    case "member_confirmed":
      return e.detail === AUTOMATIC
        ? `${actor} confirmed ${target} in your organization automatically, without comparing fingerprints`
        : `${actor} confirmed ${target} in your organization`;
    case "install_token_replaced":
      return `${actor} replaced your organization's install command`;
    case "install_domains_set":
      return e.detail
        ? `${actor} limited your organization's install command to ${e.detail.split(" ").join(", ")} accounts`
        : `${actor} let anyone with your organization's install command join`;
    case "joined_with_install_command":
      return `${target} joined your organization with the install command`;
    case "client_policy_pushed":
      return `${actor} set ${e.detail ?? "a policy"} in your organization, as ${mspName}'s default`;
    case "client_policy_required":
      return `${actor} required ${e.detail ?? "a policy"} for every client of ${mspName}, including your organization`;
    case "client_policy_default":
      return `${actor} put your organization back on ${mspName}'s default ${e.detail ?? "policy"}`;
    case "client_template_sent":
      return `${actor} sent your organization a template from ${mspName}`;
    case "templates_collection_set":
      return `${actor} made your organization's Templates folder, for ${mspName}'s templates`;
    default:
      // A newer server's, which this page has no sentence for yet.
      return `${readableCode(e.event)} (by ${actor})`;
  }
}
