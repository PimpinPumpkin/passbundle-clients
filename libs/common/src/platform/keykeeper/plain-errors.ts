// Keykeeper: what went wrong, in plain words and with what to do next, for
// every page and notice of ours (DESIGN.md, "Errors in plain words"). One
// helper in place of the copies that each printed the raw error: "Error:
// ...", "TypeError: Failed to fetch", an empty toast when a proxy answered a
// 502 with a web page, or upstream's server text such as "Invalid TOTP code!
// Server time: ... IP: ...".
//
// It never says more than the error did: a server's own sentence passes
// through only when it reads as one (no addresses, times, or database and
// stack text), and anything else gets a sentence of ours by its kind. It
// isn't for sign-in, where upstream keeps a wrong email and a wrong password
// alike so nobody learns which accounts exist.
//
// The sentences are English, like the rest of our pages' text, in one place
// for when our strings are translated.

import { ErrorResponse } from "../../models/response/error.response";

/** Our sentences, by what went wrong. */
export const PLAIN_ERRORS = {
  offline: "Couldn't reach the server. Check your internet connection, then try again.",
  slow: "The server took too long to answer. Try again in a minute.",
  tooMany: "That was tried too many times in a short while. Wait a minute, then try again.",
  serverProblem: "The server had a problem. Try again in a few minutes.",
  signedOut: "Your session ended. Sign in again, then try again.",
  notAllowed: "You don't have permission to do that. Ask an admin if you need to.",
  gone: "That isn't there anymore. Reload the page to see what's there now.",
  browserStopped: "Your browser stopped it, or it took too long. Try again.",
  unknown: "Something went wrong. Try again, and reload the page if it keeps happening.",
} as const;

/**
 * Upstream's server sentences that aren't plain, or say more than they
 * should, in plain words. Matched from the start, ignoring case.
 */
const KNOWN: [RegExp, string][] = [
  // Vaultwarden adds the server's time and the person's address to a wrong code.
  [
    /^Invalid TOTP code\b/i,
    "That code didn't work. Enter the newest code your authenticator app shows. If it still doesn't work, check that this device's clock sets itself automatically.",
  ],
  [/^TOTP code is not a number/i, "Enter the 6-digit code your authenticator app shows."],
  [/^Invalid (?:TOTP secret|key length)/i, "That setup key didn't work. Go back and start again."],
  [/^Invalid password\.?$/i, "That master password isn't right. Try again."],
  [/^No validation provided/i, "Enter your master password first."],
  [
    /^Configured `?DOMAIN`? is not compatible with Webauthn/i,
    "This server can't set up security keys at its address. Choose another way, and tell whoever runs the server.",
  ],
  [
    /webauthn/i,
    "Your security key or passkey couldn't be set up. Try again, or choose another way.",
  ],
  [
    /^Due to an Enterprise Policy, you are restricted from saving items to your personal vault/i,
    "Your organization keeps everyone's items in its shared folders, so this can't go in Personal. Choose one of its shared folders instead.",
  ],
  [
    /^The client copy of this cipher is out of date/i,
    "This item changed since you opened it. Close it, open it again, and try once more.",
  ],
  [/^Rate limit exceeded/i, PLAIN_ERRORS.tooMany],
  // "Item not found", "Cipher doesn't exist": say what to do about it.
  [/^[\w' -]{1,40} (?:not found|doesn't exist|does not exist)[.!]?$/i, PLAIN_ERRORS.gone],
];

/**
 * What a server's sentence mustn't show: the server's time, a network
 * address, a web page, database or crash text, or a dump of data.
 */
const INTERNALS: RegExp[] = [
  /server time:/i,
  /\bIP:\s/,
  /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/,
  /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/,
  /<(?:!doctype|html|head|body)\b/i,
  /\b(?:sqlite|postgres(?:ql)?|mysql|diesel|sql)\b/i,
  /\bconstraint failed\b/i,
  /\bpanicked\b|\bbacktrace\b|\btraceback\b/i,
  /^\s*[[{]/,
];

/** Longer than any sentence of ours: a page or a dump. */
const MAX_LENGTH = 400;

/** JavaScript's own errors: a bug, or an answer that couldn't be read, never words for people. */
const BUILT_IN_ERRORS = [TypeError, SyntaxError, ReferenceError, RangeError, EvalError, URIError];

/** The request never got an answer: offline, a name that doesn't resolve, a refused connection, a certificate the browser rejects. */
export function isUnreachable(e: unknown): boolean {
  return (
    e instanceof TypeError &&
    /fetch|network|load failed|connection/i.test(typeof e.message === "string" ? e.message : "")
  );
}

/** A request this page stopped waiting for (an AbortController, or AbortSignal.timeout). */
export function isTimedOut(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/** An answer from the server with its status, as upstream's ApiService throws it. */
function statusOf(e: unknown): number | null {
  if (e instanceof ErrorResponse) {
    return typeof e.statusCode === "number" ? e.statusCode : null;
  }
  return null;
}

/**
 * A server's or our code's sentence in plain words: one upstream's server
 * says unplainly is reworded, and one that would show internals gives
 * `otherwise`.
 */
export function plainSentence(sentence: string, otherwise: string = PLAIN_ERRORS.unknown): string {
  const text = sentence.replace(/^\s*(?:Error:\s*)+/i, "").trim();
  if (text === "") {
    return otherwise;
  }
  for (const [pattern, plain] of KNOWN) {
    if (pattern.test(text)) {
      return plain;
    }
  }
  if (text.length > MAX_LENGTH || INTERNALS.some((pattern) => pattern.test(text))) {
    return otherwise;
  }
  return text;
}

/** For an answer with no sentence of its own, or one that can't be shown: ours, by its status. */
function byStatus(status: number): string {
  if (status === 401) {
    return PLAIN_ERRORS.signedOut;
  }
  if (status === 403) {
    return PLAIN_ERRORS.notAllowed;
  }
  if (status === 404) {
    return PLAIN_ERRORS.gone;
  }
  if (status === 408 || status === 504) {
    return PLAIN_ERRORS.slow;
  }
  if (status === 429) {
    return PLAIN_ERRORS.tooMany;
  }
  if (status >= 500) {
    return PLAIN_ERRORS.serverProblem;
  }
  return PLAIN_ERRORS.unknown;
}

/**
 * What went wrong, for a toast or a notice: plain words that say what to do
 * next, whatever was thrown.
 *
 * - No answer (offline, a refused connection): say so.
 * - An answer from the server: too many tries and the server's own problems
 *   (a proxy's 502 included) get our words, whatever came with them;
 *   otherwise the server's sentence, in plain words (`plainSentence`), or
 *   ours for its status when it has none to show.
 * - Our own code's errors carry their sentence; JavaScript's own (a bug, an
 *   answer that couldn't be read) never reach people as they are.
 */
export function plainErrorMessage(e: unknown): string {
  if (isUnreachable(e)) {
    return PLAIN_ERRORS.offline;
  }
  if (isTimedOut(e)) {
    return PLAIN_ERRORS.slow;
  }
  const status = statusOf(e);
  if (status != null) {
    if (status === 429 || status === 408 || status >= 500) {
      return byStatus(status);
    }
    const sentence = (e as ErrorResponse).getSingleMessage();
    return typeof sentence === "string"
      ? plainSentence(sentence, byStatus(status))
      : byStatus(status);
  }
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    return e.name === "NotAllowedError" ? PLAIN_ERRORS.browserStopped : PLAIN_ERRORS.unknown;
  }
  if (e instanceof Error) {
    if (BUILT_IN_ERRORS.some((kind) => e instanceof kind)) {
      return PLAIN_ERRORS.unknown;
    }
    return plainSentence(typeof e.message === "string" ? e.message : "");
  }
  if (typeof e === "string") {
    return plainSentence(e);
  }
  return PLAIN_ERRORS.unknown;
}
