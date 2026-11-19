// Keykeeper: `passbundle login --device`, the asking side of "Approving a
// sign-in from another device" (DESIGN.md, in the meta repo; and "Command-line
// tool", "Signing in with a device's approval"). The tool makes a key pair and
// an access code, sends the request, prints the fingerprint phrase first, and
// waits for an answer, asking for it with the access code a few times a
// minute for at most 15 minutes. Approved, the caller opens the user key with
// the private key (upstream's AuthRequestService) and signs in with upstream's
// auth request sign-in. Ctrl-C, a denial, or the 15 minutes end the wait, and
// the private key is overwritten. The tool never approves anything itself.

import { ErrorResponse } from "@bitwarden/common/models/response/error.response";

import { CLI_BRAND } from "./brand";

/** How long a request lasts, as the server keeps it. */
export const REQUEST_LIFETIME_MS = 15 * 60_000;

/**
 * How long to wait before asking again: every 5 seconds for the first 2
 * minutes, when most people approve, then every 20, so a whole wait asks
 * about 60 times, well inside the server's limit for unauthenticated calls
 * from one address, which everyone at that address shares.
 */
export function pollDelay(elapsedMs: number): number {
  return elapsedMs < 2 * 60_000 ? 5_000 : 20_000;
}

/** After the server says "too many requests". */
export const TOO_MANY_DELAY_MS = 60_000;

/** What the server answers about the request, when it still has it. */
export type DeviceAnswer = {
  requestApproved?: boolean | null;
  responseDate?: string | null;
  key?: string | null;
};

/** Thrown by `answer` for a 429. */
export class TooManyRequests extends Error {}

export type DeviceWaitDeps = {
  /** The answer, or null once the server no longer has the request (denied, expired, replaced). */
  answer: () => Promise<DeviceAnswer | null>;
  /** Writes a line to stderr, so stdout stays the command's answer. */
  write: (line: string) => void;
  /** Waits, or less once `stopped` is aborted. */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Aborted by Ctrl-C. */
  stopped: AbortSignal;
};

export const STOPPED = "Stopped. Nothing was signed in.";
export const ENDED =
  "The sign-in request was denied, or it ended. Nothing was signed in. " +
  `Run \`${CLI_BRAND.command} login --device\` to ask again.`;
export const EXPIRED = "Nobody approved the sign-in within 15 minutes. Nothing was signed in.";
export const UNKNOWN_DEVICE =
  "Signing in with a device's approval works only on a computer where the tool has signed in to " +
  "your account before. Sign in here once with your master password or an API key, then sign out " +
  "and use --device next time.";

/** What the tool prints once the request is sent: the phrase first, on its own line. */
export function phraseLines(fingerprint: string, command = CLI_BRAND.command): string[] {
  return [
    `Fingerprint phrase: ${fingerprint}`,
    "On a device where you're signed in, approve this sign-in only if that device shows this same " +
      "phrase, and only if you started this sign-in yourself, here.",
    `Waiting for approval for up to 15 minutes. Press Ctrl-C to stop (\`${command} login --device\` asks again).`,
  ];
}

/**
 * Waits for the answer: the user key wrapped to the request's public key
 * once it's approved, or why it ended. Always overwrites `privateKey` when it
 * ends without an approval; on an approval, the caller opens the key and then
 * overwrites it (`forget`).
 */
export async function waitForApproval(
  started: number,
  privateKey: Uint8Array,
  deps: DeviceWaitDeps,
): Promise<{ key: string } | { error: string }> {
  const ends = started + REQUEST_LIFETIME_MS;
  const end = (error: string) => {
    forget(privateKey);
    return { error };
  };
  let delay = pollDelay(0);
  for (;;) {
    if (deps.stopped.aborted) {
      return end(STOPPED);
    }
    await deps.sleep(Math.max(0, Math.min(delay, ends - deps.now())));
    if (deps.stopped.aborted) {
      return end(STOPPED);
    }
    if (deps.now() >= ends) {
      return end(EXPIRED);
    }
    let answer: DeviceAnswer | null;
    try {
      answer = await deps.answer();
    } catch (e) {
      // Too many requests from this address: wait longer. Offline for a
      // moment: ask again until it ends.
      delay = e instanceof TooManyRequests ? TOO_MANY_DELAY_MS : pollDelay(deps.now() - started);
      continue;
    }
    if (deps.stopped.aborted) {
      return end(STOPPED);
    }
    if (answer == null) {
      return end(ENDED);
    }
    if (answer.requestApproved === true) {
      if (typeof answer.key !== "string" || answer.key === "") {
        return end(ENDED);
      }
      return { key: answer.key };
    }
    if (answer.requestApproved === false && answer.responseDate != null) {
      return end(ENDED);
    }
    delay = pollDelay(deps.now() - started);
  }
}

/** Overwrites a key in memory. */
export function forget(key: Uint8Array): void {
  key.fill(0);
}

/** A sleep that ends early when the signal is aborted. */
export function stoppableSleep(signal: AbortSignal): (ms: number) => Promise<void> {
  return (ms) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done);
    });
}

/** What the tool says when an organization requires single sign-on of the account. */
export function deviceSsoRequired(
  identifier: string | null | undefined,
  command = CLI_BRAND.command,
): string {
  const id = identifier?.trim();
  return (
    "Your organization requires you to sign in with single sign-on. A device's approval doesn't " +
    `stand in for it: run \`${command} login --sso${id ? " " + id : ""}\`.`
  );
}

/**
 * The server's own message for a refusal. Upstream's ErrorResponse puts a
 * fixed "Rate limit exceeded" in place of a 429's, which for a sign-in
 * request says which limit it was.
 */
export function serverMessage(error: ErrorResponse): string {
  if (error.statusCode === 429) {
    const body = (error as unknown as { response?: Record<string, unknown> }).response;
    const model = (body?.errorModel ?? body?.ErrorModel) as Record<string, unknown> | undefined;
    const said = model?.message ?? model?.Message ?? body?.message ?? body?.Message;
    if (typeof said === "string" && said.trim() !== "") {
      return said;
    }
  }
  return error.getSingleMessage();
}
