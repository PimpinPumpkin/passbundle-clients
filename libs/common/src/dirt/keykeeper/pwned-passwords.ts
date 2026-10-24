// Keykeeper: the one client for Have I Been Pwned's Pwned Passwords range
// API, which every exposed-password check goes through: the Health reports, a
// person's Health count, the MSP console, the item editor's check, and the
// master password check (through upstream's AuditService).
//
// k-anonymity: only the first 5 hex characters of a password's SHA-1 hash
// leave the device. The service answers with every hash suffix it knows under
// that prefix, padded with decoys (Add-Padding), and the match is made here,
// so neither the password nor its full hash is ever sent. Nothing is kept
// after a check: no password, hash, or answer. See DESIGN.md, "Exposed
// passwords".

export const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** The characters of a hash that are sent: 5 hex characters, 20 of SHA-1's 160 bits. */
export const PWNED_PASSWORDS_PREFIX_LENGTH = 5;

/**
 * A padded answer always has hundreds of lines (800 to 1,000 in 2026). Fewer
 * isn't the service's: a filtering proxy or an inspecting firewall that
 * answers with an empty page would otherwise make every password look clean.
 */
export const PWNED_PASSWORDS_MIN_LINES = 100;

/** Answers are about 30 KB; one much bigger than that isn't the service's. */
export const PWNED_PASSWORDS_MAX_BYTES = 1_000_000;

/** One line of an answer: a 35-character SHA-1 suffix and how often it was seen. */
const RANGE_LINE = /^[0-9A-F]{35}:\d{1,10}$/;

/** The check couldn't be made: offline, blocked, too slow, or an answer that isn't the service's. */
export class PwnedPasswordsUnavailableError extends Error {
  constructor(message = "Couldn't reach the Pwned Passwords service") {
    super(message);
    this.name = "PwnedPasswordsUnavailableError";
  }
}

/** The check was called off before it was made: no answer, and nothing was sent for it. */
export class PwnedPasswordsCancelledError extends Error {
  constructor() {
    super("The breach check was called off");
    this.name = "PwnedPasswordsCancelledError";
  }
}

/** What the client needs of an HTTP response. */
export type PwnedPasswordsResponse = {
  status: number;
  headers?: { get(name: string): string | null } | null;
  body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

export type PwnedPasswordsFetch = (
  url: string,
  init: RequestInit,
) => Promise<PwnedPasswordsResponse>;

/** How one check may be called off. */
export type PwnedPasswordsCheckOptions = {
  /**
   * Calls the check off. A request that every check waiting on it has called
   * off is dropped from the queue, or stopped if it's already out.
   */
  signal?: AbortSignal;
  /**
   * Asked just before the request goes out; false calls the check off. An
   * automatic check reads its setting here, so one turned off after the
   * check was queued sends nothing.
   */
  mayAsk?: () => boolean | Promise<boolean>;
};

export type PwnedPasswordsOptions = {
  /** Range requests in flight at once. */
  concurrency?: number;
  /** The least time between the starts of two requests, in milliseconds. */
  spacing?: number;
  /** A request that takes longer than this, in milliseconds, has failed. */
  timeout?: number;
  /** How long to wait before asking again after a 429 or 5xx answer, in milliseconds. */
  retryAfter?: number;
  /** The longest a Retry-After header may make it wait, in milliseconds. */
  maxRetryAfter?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

const DEFAULTS = {
  concurrency: 4,
  spacing: 25,
  timeout: 10_000,
  retryAfter: 1_000,
  maxRetryAfter: 5_000,
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
 * (seen 0 times) are left out. Anything that isn't the service's answer (a
 * line that isn't a 35-character uppercase suffix and a count, or too few
 * lines, such as an empty page or a captive portal's) is a failed check,
 * never "not exposed".
 */
export function parseRange(body: string): Map<string, number> {
  const range = new Map<string, number>();
  let lines = 0;
  for (const line of body.split(/\r?\n/)) {
    if (line === "") {
      continue;
    }
    if (!RANGE_LINE.test(line)) {
      throw new PwnedPasswordsUnavailableError(
        "The Pwned Passwords service's answer isn't a list of hashes",
      );
    }
    lines++;
    const [suffix, seen] = line.split(":");
    const count = parseInt(seen, 10);
    if (count > 0) {
      range.set(suffix, count);
    }
  }
  if (lines < PWNED_PASSWORDS_MIN_LINES) {
    throw new PwnedPasswordsUnavailableError(
      "The Pwned Passwords service's answer is too short to be a padded range",
    );
  }
  return range;
}

/** The answer's text, refusing one bigger than PWNED_PASSWORDS_MAX_BYTES. */
async function readBody(response: PwnedPasswordsResponse): Promise<string> {
  const tooBig = () =>
    new PwnedPasswordsUnavailableError("The Pwned Passwords service's answer is too big");
  const length = Number(response.headers?.get("content-length") ?? NaN);
  if (length > PWNED_PASSWORDS_MAX_BYTES) {
    throw tooBig();
  }
  const reader = response.body?.getReader?.();
  if (reader == null) {
    const text = await response.text();
    if (text.length > PWNED_PASSWORDS_MAX_BYTES) {
      throw tooBig();
    }
    return text;
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    bytes += value.byteLength;
    if (bytes > PWNED_PASSWORDS_MAX_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** A check waiting on a range download. */
type Waiter = {
  options: PwnedPasswordsCheckOptions;
  resolve: (range: Map<string, number>) => void;
  reject: (error: unknown) => void;
  done: boolean;
};

/** One prefix's download, shared by every check of that prefix while it's waiting or out. */
type Download = {
  waiters: Set<Waiter>;
  /** Aborted once every check waiting on it has been called off. */
  controller: AbortController;
};

type QueueEntry = { resolve: () => void };

/**
 * Checks passwords against Have I Been Pwned's Pwned Passwords, a few
 * requests at a time. It keeps nothing once a check is done: checks of one
 * prefix share a request only while it's waiting or out.
 */
export class PwnedPasswords {
  private readonly downloads = new Map<string, Download>();
  private readonly queue: QueueEntry[] = [];
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
   * doesn't. Throws PwnedPasswordsUnavailableError when it can't be checked,
   * and PwnedPasswordsCancelledError when it was called off.
   */
  async timesExposed(password: string, options: PwnedPasswordsCheckOptions = {}): Promise<number> {
    if (options.signal?.aborted) {
      throw new PwnedPasswordsCancelledError();
    }
    const hash = hex(await this.sha1(password));
    if (options.signal?.aborted) {
      throw new PwnedPasswordsCancelledError();
    }
    const range = await this.range(hash.slice(0, PWNED_PASSWORDS_PREFIX_LENGTH), options);
    return range.get(hash.slice(PWNED_PASSWORDS_PREFIX_LENGTH)) ?? 0;
  }

  private range(prefix: string, options: PwnedPasswordsCheckOptions): Promise<Map<string, number>> {
    return new Promise((resolve, reject) => {
      let download = this.downloads.get(prefix);
      const starts = download == null;
      if (download == null) {
        download = { waiters: new Set(), controller: new AbortController() };
        this.downloads.set(prefix, download);
      }
      const waiter: Waiter = { options, resolve, reject, done: false };
      download.waiters.add(waiter);
      const shared = download;
      options.signal?.addEventListener("abort", () => this.callOff(shared, waiter), { once: true });
      if (starts) {
        void this.run(prefix, download);
      }
    });
  }

  /** One check no longer wants its download; once none does, the download stops. */
  private callOff(download: Download, waiter: Waiter) {
    if (waiter.done) {
      return;
    }
    waiter.done = true;
    download.waiters.delete(waiter);
    waiter.reject(new PwnedPasswordsCancelledError());
    if (download.waiters.size === 0) {
      download.controller.abort();
    }
  }

  private async run(prefix: string, download: Download) {
    let outcome: { range: Map<string, number> } | { error: unknown };
    try {
      outcome = { range: await this.download(prefix, download) };
    } catch (error) {
      outcome = { error };
    }
    if (this.downloads.get(prefix) === download) {
      this.downloads.delete(prefix);
    }
    for (const waiter of download.waiters) {
      waiter.done = true;
      if ("range" in outcome) {
        waiter.resolve(outcome.range);
      } else {
        waiter.reject(outcome.error);
      }
    }
    download.waiters.clear();
  }

  private async download(prefix: string, download: Download): Promise<Map<string, number>> {
    if (!/^[0-9A-F]{5}$/.test(prefix)) {
      // Never send anything but a 5-character prefix.
      throw new PwnedPasswordsUnavailableError("Not a hash prefix");
    }
    const signal = download.controller.signal;
    const failuresBefore = this.failures;
    // Throws, without taking a slot, if called off while queued.
    await this.turn(signal);
    try {
      if (this.failures !== failuresBefore) {
        // A request failed while this one waited: offline or blocked, most
        // likely, so this one fails at once instead of waiting out a timeout
        // too. Checks asked for after the failure try again.
        throw new PwnedPasswordsUnavailableError();
      }
      // Each check still waiting may have been called off meanwhile, or its
      // setting turned off.
      for (const waiter of [...download.waiters]) {
        if (waiter.options.mayAsk != null && !(await waiter.options.mayAsk())) {
          this.callOff(download, waiter);
        }
      }
      if (signal.aborted) {
        throw new PwnedPasswordsCancelledError();
      }
      return await this.ask(prefix, signal);
    } finally {
      this.release();
    }
  }

  /** Asks for one range, once more after a 429 or 5xx answer. */
  private async ask(prefix: string, calledOff: AbortSignal): Promise<Map<string, number>> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const stop = () => controller.abort();
      const timer = setTimeout(stop, this.options.timeout);
      calledOff.addEventListener("abort", stop, { once: true });
      try {
        if (calledOff.aborted) {
          throw new PwnedPasswordsCancelledError();
        }
        const response = await this.fetch(PWNED_PASSWORDS_RANGE_URL + prefix, {
          method: "GET",
          // Decoy entries, so the answer's size doesn't hint at the prefix.
          headers: { "Add-Padding": "true" },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          // Not into the browser's disk cache, which would keep which prefixes
          // were asked about.
          cache: "no-store",
          // Only the service itself answers.
          redirect: "error",
          signal: controller.signal,
        });
        if (response.status === 200) {
          return parseRange(await readBody(response));
        }
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          const retryAfter = Number(response.headers?.get("retry-after") ?? NaN) * 1000;
          await this.options.wait(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter, this.options.maxRetryAfter)
              : this.options.retryAfter,
          );
          continue;
        }
        throw new PwnedPasswordsUnavailableError(
          `The Pwned Passwords service answered ${response.status}`,
        );
      } catch (e) {
        if (calledOff.aborted) {
          // Called off, not a failure: the checks behind it don't fail.
          throw new PwnedPasswordsCancelledError();
        }
        this.failures++;
        throw e instanceof PwnedPasswordsUnavailableError
          ? e
          : new PwnedPasswordsUnavailableError();
      } finally {
        clearTimeout(timer);
        calledOff.removeEventListener("abort", stop);
      }
    }
  }

  /** Waits for a free request slot, then for the spacing since the last start. */
  private async turn(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new PwnedPasswordsCancelledError();
    }
    if (this.active < this.options.concurrency) {
      this.active++;
    } else {
      // The slot is handed over by release(), still counted as active.
      await new Promise<void>((resolve, reject) => {
        const entry: QueueEntry = { resolve };
        this.queue.push(entry);
        signal.addEventListener(
          "abort",
          () => {
            const index = this.queue.indexOf(entry);
            if (index >= 0) {
              this.queue.splice(index, 1);
              reject(new PwnedPasswordsCancelledError());
            }
          },
          { once: true },
        );
      });
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
      next.resolve();
    } else {
      this.active--;
    }
  }
}

/** A copy in random order, so requests don't go out in the vault's order. */
export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomIndex(below: number): number {
  const random = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0];
  return random == null ? Math.floor(Math.random() * below) : random % below;
}

/**
 * Checks each different password once, in random order, and says how far
 * it got. A password that couldn't be checked is null; one that was is how
 * many times it was seen (0 for none). Throws PwnedPasswordsCancelledError
 * when the run was called off (its signal, or a mayAsk that said no).
 */
export async function checkPasswords(
  passwords: Iterable<string>,
  timesExposed: (password: string, options: PwnedPasswordsCheckOptions) => Promise<number>,
  progress?: (checked: number, total: number) => void,
  options: PwnedPasswordsCheckOptions = {},
): Promise<Map<string, number | null>> {
  const unique = shuffled([...new Set(passwords)]);
  const results = new Map<string, number | null>();
  let checked = 0;
  let calledOff = false;
  progress?.(0, unique.length);
  await Promise.all(
    unique.map(async (password) => {
      try {
        results.set(password, await timesExposed(password, options));
      } catch (e) {
        if (e instanceof PwnedPasswordsCancelledError) {
          calledOff = true;
          return;
        }
        results.set(password, null);
      }
      checked++;
      progress?.(checked, unique.length);
    }),
  );
  if (calledOff || options.signal?.aborted) {
    throw new PwnedPasswordsCancelledError();
  }
  return results;
}
