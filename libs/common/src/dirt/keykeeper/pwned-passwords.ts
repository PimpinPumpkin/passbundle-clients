// Keykeeper: the one client for Have I Been Pwned's Pwned Passwords range
// API, which every exposed-password check goes through: the Health reports, a
// person's Health count, the MSP console, the item editor's check, and the
// master password check (through upstream's AuditService).
//
// k-anonymity: only the first 5 hex characters of a password's SHA-1 hash
// leave the device. The service answers with every hash suffix it knows under
// that prefix, padded with decoys (Add-Padding), and the match is made here,
// so neither the password nor its full hash is ever sent. See DESIGN.md,
// "Exposed passwords".

export const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** The characters of a hash that are sent: 5 hex characters, 20 of SHA-1's 160 bits. */
export const PWNED_PASSWORDS_PREFIX_LENGTH = 5;

/** The check couldn't be made: offline, blocked by a firewall, too slow, or an answer that isn't a range. */
export class PwnedPasswordsUnavailableError extends Error {
  constructor(message = "Couldn't reach the Pwned Passwords service") {
    super(message);
    this.name = "PwnedPasswordsUnavailableError";
  }
}

/** What the client needs of an HTTP response. */
export type PwnedPasswordsResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type PwnedPasswordsFetch = (
  url: string,
  init: RequestInit,
) => Promise<PwnedPasswordsResponse>;

export type PwnedPasswordsOptions = {
  /** Range requests in flight at once. */
  concurrency?: number;
  /** The least time between the starts of two requests, in milliseconds. */
  spacing?: number;
  /** A request that takes longer than this, in milliseconds, has failed. */
  timeout?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

const DEFAULTS = {
  concurrency: 4,
  spacing: 25,
  timeout: 10_000,
};

function hex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += byte.toString(16).padStart(2, "0");
  }
  return text.toUpperCase();
}

/**
 * The suffixes of a range answer with how often each was seen. Padding lines
 * (seen 0 times) are left out. Anything that isn't a list of hex suffixes and
 * counts, such as a captive portal's page, is a failed check, never "not
 * exposed".
 */
export function parseRange(body: string): Map<string, number> {
  const range = new Map<string, number>();
  for (const line of body.split(/\r?\n/)) {
    const entry = line.trim();
    if (entry === "") {
      continue;
    }
    const match = /^([0-9A-Fa-f]+):(\d+)$/.exec(entry);
    if (match == null) {
      throw new PwnedPasswordsUnavailableError(
        "The Pwned Passwords service's answer isn't a list of hashes",
      );
    }
    const count = parseInt(match[2], 10);
    if (count > 0) {
      range.set(match[1].toUpperCase(), count);
    }
  }
  return range;
}

/**
 * Checks passwords against Have I Been Pwned's Pwned Passwords, a few
 * requests at a time. What it learns is kept in memory for this session only,
 * by hash, so a password used in many places (or by many clients) is asked
 * about once; the web vault reloads when it locks, which drops it.
 */
export class PwnedPasswords {
  /** Times seen, by full SHA-1 hash (uppercase hex), for passwords already checked. */
  private readonly known = new Map<string, number>();
  /** Ranges being downloaded, by prefix, so checks of one prefix share a request. */
  private readonly downloading = new Map<string, Promise<Map<string, number>>>();
  private readonly queue: (() => void)[] = [];
  private active = 0;
  private nextStart = 0;
  /** Requests that failed, so the ones waiting behind a failure fail at once. */
  private failures = 0;
  private readonly options: Required<PwnedPasswordsOptions>;

  constructor(
    private readonly sha1: (text: string) => Promise<Uint8Array>,
    private readonly fetch: PwnedPasswordsFetch,
    options: PwnedPasswordsOptions = {},
  ) {
    this.options = {
      ...DEFAULTS,
      now: () => Date.now(),
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      ...options,
    };
  }

  /**
   * How many times the password appears in known breaches, 0 when it
   * doesn't. Throws PwnedPasswordsUnavailableError when it can't be checked.
   */
  async timesExposed(password: string): Promise<number> {
    const hash = hex(await this.sha1(password));
    const known = this.known.get(hash);
    if (known !== undefined) {
      return known;
    }
    const range = await this.range(hash.slice(0, PWNED_PASSWORDS_PREFIX_LENGTH));
    const count = range.get(hash.slice(PWNED_PASSWORDS_PREFIX_LENGTH)) ?? 0;
    this.known.set(hash, count);
    return count;
  }

  /** Drops what this session learned. */
  forget(): void {
    this.known.clear();
  }

  private range(prefix: string): Promise<Map<string, number>> {
    let range = this.downloading.get(prefix);
    if (range == null) {
      range = this.download(prefix).finally(() => this.downloading.delete(prefix));
      this.downloading.set(prefix, range);
    }
    return range;
  }

  private async download(prefix: string): Promise<Map<string, number>> {
    if (!/^[0-9A-F]{5}$/.test(prefix)) {
      // Never send anything but a 5-character prefix.
      throw new PwnedPasswordsUnavailableError("Not a hash prefix");
    }
    const failuresBefore = this.failures;
    await this.turn();
    try {
      if (this.failures !== failuresBefore) {
        // A request failed while this one waited: offline or blocked, most
        // likely, so this one fails at once instead of waiting out a timeout
        // too. Checks asked for after the failure try again.
        throw new PwnedPasswordsUnavailableError();
      }
      return await this.ask(prefix);
    } finally {
      this.release();
    }
  }

  private async ask(prefix: string): Promise<Map<string, number>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeout);
    try {
      const response = await this.fetch(PWNED_PASSWORDS_RANGE_URL + prefix, {
        method: "GET",
        // Decoy entries, so the answer's size doesn't hint at the prefix.
        headers: { "Add-Padding": "true" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        // Not into the browser's disk cache, which would keep which prefixes
        // were asked about.
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new PwnedPasswordsUnavailableError(
          `The Pwned Passwords service answered ${response.status}`,
        );
      }
      return parseRange(await response.text());
    } catch (e) {
      this.failures++;
      throw e instanceof PwnedPasswordsUnavailableError ? e : new PwnedPasswordsUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Waits for a free request slot, then for the spacing since the last start. */
  private async turn(): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active++;
    } else {
      // The slot is handed over by release(), still counted as active.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    const now = this.options.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + this.options.spacing;
    if (start > now) {
      await this.options.wait(start - now);
    }
  }

  private release() {
    const next = this.queue.shift();
    if (next != null) {
      next();
    } else {
      this.active--;
    }
  }
}

/**
 * Checks each different password once and says how far it got. A password
 * that couldn't be checked is null; one that was is how many times it was
 * seen (0 for none).
 */
export async function checkPasswords(
  passwords: Iterable<string>,
  timesExposed: (password: string) => Promise<number>,
  progress?: (checked: number, total: number) => void,
): Promise<Map<string, number | null>> {
  const unique = [...new Set(passwords)];
  const results = new Map<string, number | null>();
  let checked = 0;
  progress?.(0, unique.length);
  await Promise.all(
    unique.map(async (password) => {
      try {
        results.set(password, await timesExposed(password));
      } catch {
        results.set(password, null);
      }
      checked++;
      progress?.(checked, unique.length);
    }),
  );
  return results;
}
