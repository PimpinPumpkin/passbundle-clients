// Keykeeper: the new-device check in the command-line tool (DESIGN.md,
// "New-device check", in the meta repo). An account without two-step login
// that logs in with its password on a computer it has never used waits: the
// tool prints the number to type on a device already signed in, and waits for
// it, or, when no device can approve, asks for the code the server emails.
// The tool never approves anything itself.

import { KeykeeperNewDeviceCheck } from "@bitwarden/common/auth/keykeeper/new-device-check";

export type NewDeviceDeps = {
  /** The check as it stands now, or null once it has ended. */
  status: (check: KeykeeperNewDeviceCheck) => Promise<KeykeeperNewDeviceCheck | null>;
  /** Sends the code by email, and the check after. */
  sendEmail: (check: KeykeeperNewDeviceCheck) => Promise<KeykeeperNewDeviceCheck | null>;
  /** Writes a line to stderr, so stdout stays the command's answer. */
  write: (line: string) => void;
  /** Asks a question, when the tool may. */
  ask: (question: string) => Promise<string>;
  canInteract: boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export const NEW_DEVICE_POLL_MS = 3000;

/**
 * What to send the server to finish the login: the approved check's token,
 * or the code from the email. Or why it can't go on.
 */
export async function keykeeperWaitForNewDevice(
  first: KeykeeperNewDeviceCheck,
  deps: NewDeviceDeps,
): Promise<{ otp: string } | { error: string }> {
  let check = first;
  if (check.status === "approved") {
    return { otp: check.token };
  }
  if (check.status === "denied") {
    return { error: deniedSentence(check) };
  }

  if (!check.approvers) {
    if (check.email !== "now") {
      return {
        error:
          "This computer is new to your account, and none of your devices can approve it. Log in on a device you've used before.",
      };
    }
    if (!deps.canInteract) {
      return {
        error:
          "This computer is new to your account, and none of your devices can approve it, so it needs a code by email. Run login where it can ask you for the code.",
      };
    }
    const sent = await deps.sendEmail(check);
    if (sent == null) {
      return { error: ENDED };
    }
    deps.write(
      `This computer is new to your account. We sent a code to ${sent.emailTo ?? "your email"}.`,
    );
    const code = (await deps.ask("Code from the email:")).replace(/\s/g, "");
    return code ? { otp: code } : { error: "Code is required." };
  }

  deps.write("This computer is new to your account, so this login waits for approval.");
  deps.write(
    `On a device where you're already signed in, open your vault and type this number: ${check.number}`,
  );
  deps.write("Waiting for approval. This works for 10 minutes.");
  const ends = Date.parse(check.expiresAt);
  for (;;) {
    await deps.sleep(NEW_DEVICE_POLL_MS);
    if (!Number.isNaN(ends) && deps.now() > ends) {
      return { error: ENDED };
    }
    let now: KeykeeperNewDeviceCheck | null;
    try {
      now = await deps.status(check);
    } catch {
      // Offline for a moment: keep asking until it ends.
      continue;
    }
    if (now == null) {
      return { error: ENDED };
    }
    check = { ...now, token: check.token };
    if (check.status === "approved") {
      return { otp: check.token };
    }
    if (check.status === "denied") {
      return { error: deniedSentence(check) };
    }
  }
}

const ENDED = "This login has ended. Run login again.";

function deniedSentence(check: KeykeeperNewDeviceCheck): string {
  return check.deniedWhy === "number"
    ? "The number typed on your other device didn't match, so this login was denied. Run login again to get a new number."
    : "This login was denied from one of your devices.";
}
