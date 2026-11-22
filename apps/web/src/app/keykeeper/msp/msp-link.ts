// Keykeeper: an organization that already uses PassBundle joins an MSP, or
// moves from one MSP to another, with a one-time code the MSP gives its owner
// (DESIGN.md, "An organization that already uses PassBundle"). The words the
// owner reads before saying yes, which of the MSP's people they may confirm
// by hand, and the code as people type it. The server checks everything
// again; nothing here decides who gets in.

import {
  ClientMspStaff,
  LinkPerson,
  LinkPreview,
  LinkResult,
} from "@bitwarden/admin-console/common";

/** Crockford's base32, as the server makes codes: no I, L, O, or U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * What someone typed, read as a code the way the server reads it (case,
 * spaces, and dashes don't matter; O reads as 0, I and L as 1), or null when
 * it can't be one. Only for saying so before asking the server.
 */
export function readLinkCode(typed: string): string | null {
  let code = "";
  for (const c of typed.toUpperCase()) {
    if (c === " " || c === "-" || c === "\t") {
      continue;
    }
    const read = c === "O" ? "0" : c === "I" || c === "L" ? "1" : c;
    if (!ALPHABET.includes(read)) {
      return null;
    }
    code += read;
  }
  return code.length === 24 ? code : null;
}

/** Someone, by name and email, or by email alone. */
export function who(person: { name: string | null; email: string }): string {
  const name = person.name?.trim();
  return name ? `${name} (${person.email})` : person.email;
}

/** A role as the server names it, in words: "as an owner", "as an admin", or a custom role. */
export function asRole(role: string | undefined): string {
  switch (role) {
    case "owner":
      return "as an owner";
    case "admin":
      return "as an admin";
    case "custom items":
      return "with a custom role that sees every item";
    case "custom":
      return "with a custom role";
    default:
      return "as a member";
  }
}

/** One of the MSP's people who would join, as the page lists them. */
export function joiningLine(person: LinkPerson): string {
  return `${who(person)}, ${asRole(person.role)}`;
}

/** Our sentences by message key, with their values (upstream's I18nService.t). */
export type Translate = (key: string, ...values: string[]) => string;

/**
 * What joining with this code means, in plain sentences, before anything
 * changes: who's added; that an owner here confirms one of the MSP's admins
 * first, comparing phrases, and that the rest of its people, and anyone it
 * adds later, are let in automatically after that, with no phrase compared
 * (DESIGN.md, "Joining"); what the organization keeps; and that the MSP can
 * be removed. For a move, that the MSP it has now goes first.
 */
export function previewSentences(
  preview: LinkPreview,
  organizationName: string,
  t: Translate,
): string[] {
  const msp = preview.msp.name;
  const sentences: string[] = [];
  if (preview.current != null) {
    const current = preview.current.name;
    sentences.push(
      `${current} manages ${organizationName} now. Moving removes ${current} and all of its staff from it first, as Remove ${current} does: the script and provisioning tokens and event destinations they made here stop working, and so does ${current}'s install command. Then ${msp} is added.`,
    );
  }
  sentences.push(
    preview.adding.length === 0
      ? t("keykeeperMspJoinNobodyNow", msp, organizationName)
      : t("keykeeperMspJoinAddedWait", msp, organizationName),
  );
  sentences.push(t("keykeeperMspJoinThenAutomatic", msp, organizationName));
  if (preview.stayingOut.length > 0) {
    sentences.push(
      `You removed or revoked ${preview.stayingOut.map((p) => who(p)).join(", ")} here before. They stay out until you invite them again.`,
    );
  }
  sentences.push(
    `${organizationName} keeps its members, items, collections, policies, and plan. ${msp} can offer its default policies; nothing changes until someone applies them.`,
  );
  sentences.push(`You can remove ${msp} at any time, on this page.`);
  return sentences;
}

/**
 * The notice once the organization joined or moved: whom an owner here
 * confirms now. One of the MSP's admins, who are owners here, after comparing
 * their phrase; the rest are let in after that with no phrase compared. With
 * none of its admins added, nobody on the MSP's side can let anyone in, so
 * each person added waits for an owner here.
 */
export function joinedMessage(
  result: LinkResult,
  preview: LinkPreview,
  organizationName: string,
  t: Translate,
): string {
  const msp = result.msp.name;
  if (result.added === 0) {
    return `${msp} now manages ${organizationName}.`;
  }
  const admins = preview.adding.filter((p) => p.role === "owner");
  if (admins.length === 1) {
    return t("keykeeperMspJoinedConfirmAdmin", msp, organizationName, who(admins[0]));
  }
  if (admins.length > 1) {
    return t("keykeeperMspJoinedConfirmAnAdmin", msp, organizationName);
  }
  const people = preview.adding.map((p) => who(p)).join(", ");
  return `${msp} now manages ${organizationName}. Confirm ${people} below once you've compared their phrases.`;
}

/** What the button says: join, or move. */
export function joinButton(preview: LinkPreview): string {
  return preview.current == null ? `Join ${preview.msp.name}` : `Move to ${preview.msp.name}`;
}

/** Upstream's membership status for someone waiting for the organization's key. */
const WAITING = 1;
const USER = 2;

/** One of the MSP's people waiting for the organization's key, and whether this viewer may confirm them. */
export type Waiting = { person: ClientMspStaff; canConfirm: boolean };

/**
 * The MSP's people waiting for this organization's key, for its own owners
 * and admins to confirm by hand. Upstream's rule: an owner confirms anyone,
 * an admin only regular members (a custom role), so the MSP's admins, who
 * are owners there, wait for an owner. People without a key from the server
 * can't be confirmed here.
 */
export function waitingStaff(staff: ClientMspStaff[], viewer: { isOwner: boolean }): Waiting[] {
  return staff
    .filter((s) => s.status === WAITING)
    .map((person) => ({
      person,
      canConfirm:
        person.publicKey != null &&
        person.publicKey !== "" &&
        (viewer.isOwner || person.type === USER),
    }));
}

/** The sentence beside a waiting person's phrase: what to compare, and what a difference means. */
export function confirmLine(person: { name: string | null; email: string }): string {
  const name = person.name?.trim() || person.email;
  return `Ask ${name} to read the phrase in Settings, My account, and confirm them only if it's the same: otherwise the key this server gave out for them isn't theirs.`;
}
