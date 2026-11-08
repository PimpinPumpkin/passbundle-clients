// Keykeeper: whether a server answers at an address someone typed in "Where's
// your vault?", before it's saved (DESIGN.md, "The look"). Without it, a typo
// was saved as it was and showed up only after the master password, as "An
// unexpected error has occurred."
//
// It asks for the server's settings (GET <address>/api/config), which every
// PassBundle server, and every server the extension can sign in to, answers
// without signing in. Nothing is sent but the request: no credentials, no
// cookies, and nothing about the person.

import { InjectionToken } from "@angular/core";

import { isTimedOut } from "@bitwarden/common/platform/keykeeper/plain-errors";

/** What's wrong with the address, or nothing. */
export type ServerCheck =
  | { ok: true }
  | {
      ok: false;
      /**
       * unreachable: no answer at all (offline, a name that doesn't resolve,
       * a refused connection, a certificate the browser rejects); slow: no
       * answer in time; notAServer: something answered, but not a server to
       * sign in to (a website, a typo's parked domain); broken: the server
       * (or the proxy before it) answered with a problem of its own.
       */
      problem: "unreachable" | "slow" | "notAServer" | "broken";
    };

/** Long enough for a slow connection, short enough not to leave someone waiting. */
export const SERVER_CHECK_TIMEOUT_MS = 15_000;

/** Makes the check's request: the browser's own fetch, or the tests'. */
export type ServerCheckFetch = (url: string, init: RequestInit) => Promise<Response>;

export const KEYKEEPER_SERVER_CHECK_FETCH = new InjectionToken<ServerCheckFetch>(
  "KeykeeperServerCheckFetch",
  { providedIn: "root", factory: () => (url, init) => fetch(url, init) },
);

/** The settings' address for a server's base address. */
export function serverConfigUrl(base: string): string {
  return base.replace(/\/+$/, "") + "/api/config";
}

/** Asks the server at `base` for its settings. */
export async function checkServer(
  base: string,
  fetch: ServerCheckFetch,
  timeoutMs = SERVER_CHECK_TIMEOUT_MS,
): Promise<ServerCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(serverConfigUrl(base), {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status >= 500) {
      return { ok: false, problem: "broken" };
    }
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/\bjson\b/i.test(type)) {
      return { ok: false, problem: "notAServer" };
    }
    const settings = (await response.json().catch((): unknown => null)) as {
      object?: unknown;
      version?: unknown;
    } | null;
    return settings?.object === "config" && typeof settings.version === "string"
      ? { ok: true }
      : { ok: false, problem: "notAServer" };
  } catch (e) {
    return {
      ok: false,
      problem: isTimedOut(e) || controller.signal.aborted ? "slow" : "unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}
