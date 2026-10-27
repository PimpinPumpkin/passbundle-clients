// Keykeeper: the words for offboarding (DESIGN.md, "Offboarding"): what
// removing an MSP took out of a client, people the client took off its MSP's
// staff, and the prompt to replace an install command after removals.

import { MspClient, MspRemoval, MspStaffMember } from "@bitwarden/admin-console/common";

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

/** A list in words: "a", "a and b", "a, b, and c". */
export function inWords(items: string[]): string {
  if (items.length < 3) {
    return items.join(" and ");
  }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** What removing an MSP took out, for the client's owner, in plain sentences. */
export function describeMspRemoval(removal: MspRemoval): {
  people: string;
  removed: string[];
  installCommand: string;
  singleSignOn: string | null;
} {
  const msp = removal.msp.name;
  const removed: string[] = [];
  if (removal.scriptTokensRevoked.length > 0) {
    const names = removal.scriptTokensRevoked.map((t) => t.name);
    removed.push(
      `Script tokens they made, now revoked: ${inWords(names)}. Make new ones on the Settings page if your scripts still need them.`,
    );
  }
  if (removal.provisioningTokenRevoked != null) {
    removed.push(
      `The provisioning token ${removal.provisioningTokenRevoked.createdBy} made, now revoked. Microsoft Entra ID stops updating your members until you make a new one on the Provisioning page.`,
    );
  }
  if (removal.eventDestinationsDeleted.length > 0) {
    const names = removal.eventDestinationsDeleted.map((d) => d.name);
    removed.push(`Event destinations they set up, now deleted: ${inWords(names)}.`);
  }
  if (removal.staffSealsDeleted > 0) {
    removed.push("What let your apps confirm their staff on their own.");
  }
  const sso = removal.singleSignOn;
  return {
    people:
      removal.peopleRemoved > 0
        ? `${people(removal.peopleRemoved)} from ${msp} lost access to this organization.`
        : `Nobody from ${msp} was left in this organization.`,
    removed,
    installCommand: `${msp}'s install command stopped working. Make your own on the Settings page and run it on your computers.`,
    singleSignOn:
      sso == null
        ? null
        : `Review single sign-on on the Settings page: it's ${sso.enabled ? "on" : "off"}, and ${
            sso.updatedByProvider ? `${sso.updatedBy}, from ${msp},` : sso.updatedBy
          } last changed it.`,
  };
}

/** For the MSP console: the clients that removed or revoked this person themselves. */
export function removedByClientLine(
  person: MspStaffMember,
  clients: { id: string; name: string }[],
): string | null {
  const entries = person.removedByClient ?? [];
  if (entries.length === 0) {
    return null;
  }
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? "a client";
  const removed = entries.filter((e) => !e.revoked).map((e) => name(e.organizationId));
  const revoked = entries.filter((e) => e.revoked).map((e) => name(e.organizationId));
  const parts = [];
  if (removed.length > 0) {
    parts.push(`Removed by the client in ${inWords(removed)}`);
  }
  if (revoked.length > 0) {
    parts.push(
      `${removed.length > 0 ? "revoked" : "Revoked"} by the client in ${inWords(revoked)}`,
    );
  }
  return `${parts.join("; ")}. Your changes don't add them back there; only the client can.`;
}

/** For the MSP console's client row: the MSP's people this client took out itself. */
export function clientRemovedLine(client: MspClient): string | null {
  const entries = client.removedByClient ?? [];
  if (entries.length === 0) {
    return null;
  }
  const who = (revoked: boolean) =>
    entries.filter((e) => e.revoked === revoked).map((e) => e.email ?? "someone");
  const parts = [];
  if (who(false).length > 0) {
    parts.push(`removed ${inWords(who(false))}`);
  }
  if (who(true).length > 0) {
    parts.push(`revoked ${inWords(who(true))}`);
  }
  return `The client ${parts.join(" and ")}`;
}

/**
 * The prompt to replace an install command's token after removals, or null
 * when there were none since it was made. `provider` names the MSP that
 * manages a client's command.
 */
export function replaceTokenPrompt(
  removedSinceToken: number | undefined,
  provider?: string,
): string | null {
  if (!removedSinceToken) {
    return null;
  }
  const since = `${people(removedSinceToken)} ${removedSinceToken === 1 ? "was" : "were"} removed since the install command was made.`;
  const after =
    "Anyone who kept it can still ask to join; an admin has to approve them, but replacing the token stops the old command for good.";
  return provider == null
    ? `${since} ${after}`
    : `${since} ${after} ${provider} manages it: ask them to replace the token.`;
}
