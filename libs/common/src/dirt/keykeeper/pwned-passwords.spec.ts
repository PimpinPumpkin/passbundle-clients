import { createHash } from "crypto";

import {
  checkPasswords,
  parseRange,
  PWNED_PASSWORDS_MAX_BYTES,
  PWNED_PASSWORDS_RANGE_URL,
  PwnedPasswords,
  PwnedPasswordsCancelledError,
  PwnedPasswordsFetch,
  PwnedPasswordsResponse,
  PwnedPasswordsUnavailableError,
  shuffled,
} from "./pwned-passwords";

const sha1 = async (text: string) => new Uint8Array(createHash("sha1").update(text).digest());
const sha1Hex = (text: string) => createHash("sha1").update(text).digest("hex").toUpperCase();

/** A padded range answer, as the service gives it: decoys seen 0 times, plus the given suffixes. */
function rangeBody(entries: Record<string, number>, lineEnd = "\r\n", decoys = 400): string {
  const lines = Array.from({ length: decoys }, (_, i) => `${sha1Hex(`decoy ${i}`).slice(5)}:0`);
  for (const [suffix, count] of Object.entries(entries)) {
    lines.push(`${suffix}:${count}`);
  }
  return lines.sort().join(lineEnd);
}

function answer(body: string, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  } satisfies PwnedPasswordsResponse;
}

type Call = { url: string; init: RequestInit };

/** A range API that knows the given passwords and how often each was seen. */
function serviceKnowing(seen: Record<string, number>) {
  const calls: Call[] = [];
  const known = Object.entries(seen).map(
    ([password, count]) => [sha1Hex(password), count] as const,
  );
  const fetch = jest.fn<ReturnType<PwnedPasswordsFetch>, Parameters<PwnedPasswordsFetch>>(
    async (url, init) => {
      calls.push({ url, init });
      const prefix = url.slice(PWNED_PASSWORDS_RANGE_URL.length);
      const entries: Record<string, number> = {};
      for (const [hash, count] of known) {
        if (hash.startsWith(prefix)) {
          entries[hash.slice(5)] = count;
        }
      }
      return answer(rangeBody(entries));
    },
  );
  return { fetch, calls };
}

/** A fetch whose answers wait until the test lets them go. */
function heldService() {
  const pending: { url: string; init: RequestInit; release: () => void }[] = [];
  const fetch = jest.fn<ReturnType<PwnedPasswordsFetch>, Parameters<PwnedPasswordsFetch>>(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        pending.push({ url, init, release: () => resolve(answer(rangeBody({}))) });
      }),
  );
  return { fetch, pending };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PwnedPasswords (k-anonymity range checks)", () => {
  it("sends only the first 5 characters of the password's SHA-1 hash, asking for padding", async () => {
    const password = "correct horse battery staple";
    const hash = sha1Hex(password);
    const { fetch, calls } = serviceKnowing({ [password]: 3 });

    expect(await new PwnedPasswords(sha1, fetch).timesExposed(password)).toBe(3);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(url.slice(url.lastIndexOf("/") + 1)).toMatch(/^[0-9A-F]{5}$/);
    expect(init.headers).toEqual({ "Add-Padding": "true" });
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    // Nothing else about the password goes anywhere.
    const sent = url + JSON.stringify({ ...init, signal: undefined });
    expect(sent).not.toContain(password);
    expect(sent).not.toContain(hash.slice(5));
    expect(sent).not.toContain(hash.slice(5).toLowerCase());
  });

  it("matches the suffix in the answer, with either line ending, and answers 0 when it isn't there", async () => {
    const hash = sha1Hex("hunter2");
    for (const body of [
      rangeBody({ [hash.slice(5)]: 17 }, "\n"),
      rangeBody({ [hash.slice(5)]: 17 }, "\r\n"),
    ]) {
      const client = new PwnedPasswords(sha1, async () => answer(body));
      expect(await client.timesExposed("hunter2")).toBe(17);
    }
    const missing = new PwnedPasswords(sha1, async () => answer(rangeBody({})));
    expect(await missing.timesExposed("hunter2")).toBe(0);
  });

  it("counts a padding entry (seen 0 times) as not exposed", async () => {
    const hash = sha1Hex("hunter2");
    const client = new PwnedPasswords(sha1, async () => answer(rangeBody({ [hash.slice(5)]: 0 })));
    expect(await client.timesExposed("hunter2")).toBe(0);
  });

  it("keeps nothing: a later check asks again, and checks waiting together share one request", async () => {
    const { fetch } = serviceKnowing({ password1: 2_000_000 });
    const client = new PwnedPasswords(sha1, fetch);

    const together = await Promise.all([
      client.timesExposed("password1"),
      client.timesExposed("password1"),
    ]);
    expect(together).toEqual([2_000_000, 2_000_000]);
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(await client.timesExposed("password1")).toBe(2_000_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one request between passwords whose hashes start alike", async () => {
    const hashes: Record<string, string> = {
      a: "ABCDE" + "1".repeat(35),
      b: "ABCDE" + "2".repeat(35),
    };
    const fakeSha1 = async (text: string) =>
      Uint8Array.from(hashes[text].match(/../g)!.map((byte) => parseInt(byte, 16)));
    const fetch = jest.fn(async () => answer(rangeBody({ ["1".repeat(35)]: 5 })));
    const client = new PwnedPasswords(fakeSha1, fetch);

    expect(await Promise.all([client.timesExposed("a"), client.timesExposed("b")])).toEqual([5, 0]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails, instead of answering 0, for anything that isn't the service's padded answer, and asks again next time", async () => {
    const failures: [string, PwnedPasswordsFetch][] = [
      [
        "offline",
        async () => {
          throw new TypeError("Failed to fetch");
        },
      ],
      ["an empty 200", async () => answer("")],
      ["a whitespace 200", async () => answer("  \r\n \t\r\n")],
      ["a 204", async () => answer("", 204)],
      ["a 2xx other than 200", async () => answer(rangeBody({}), 203)],
      ["a 404", async () => answer("", 404)],
      ["too few lines", async () => answer(rangeBody({}, "\r\n", 50))],
      ["lowercase suffixes", async () => answer(rangeBody({}).toLowerCase())],
      ["a count over 10 digits", async () => answer(rangeBody({ ["A".repeat(35)]: 12345678901 }))],
      ["a short suffix", async () => answer(rangeBody({ ABC: 3 }))],
      [
        "a captive portal",
        async () => answer("<html><body>Sign in to the guest Wi-Fi</body></html>"),
      ],
      [
        "an answer over the size cap",
        async () => answer(rangeBody({}) + "\r\n" + "x".repeat(PWNED_PASSWORDS_MAX_BYTES)),
      ],
      [
        "a Content-Length over the size cap",
        async () =>
          answer(rangeBody({}), 200, { "content-length": String(PWNED_PASSWORDS_MAX_BYTES + 1) }),
      ],
    ];
    for (const [what, fetch] of failures) {
      const counted = jest.fn(fetch);
      const client = new PwnedPasswords(sha1, counted, { retryAfter: 0 });
      await expect(client.timesExposed("hunter2")).rejects.toBeInstanceOf(
        PwnedPasswordsUnavailableError,
      );
      // Never kept: the next check asks again.
      await expect(client.timesExposed("hunter2")).rejects.toBeInstanceOf(
        PwnedPasswordsUnavailableError,
      );
      expect([what, counted.mock.calls.length > 1]).toEqual([what, true]);
    }
  });

  it("reads the answer from the body stream, refusing more than the size cap", async () => {
    const encoder = new TextEncoder();
    const streamed = (text: string) => {
      const chunks = [encoder.encode(text.slice(0, 1000)), encoder.encode(text.slice(1000))];
      let next = 0;
      const cancel = jest.fn(async () => undefined);
      const body = {
        getReader: () => ({
          read: async () =>
            next < chunks.length
              ? { done: false as const, value: chunks[next++] }
              : { done: true as const, value: undefined },
          cancel,
        }),
      } as unknown as ReadableStream<Uint8Array>;
      return { body, cancel };
    };
    const hash = sha1Hex("hunter2");
    const ok = streamed(rangeBody({ [hash.slice(5)]: 9 }));
    const fine = new PwnedPasswords(sha1, async () => ({
      ...answer(""),
      body: ok.body,
    }));
    expect(await fine.timesExposed("hunter2")).toBe(9);

    const big = streamed("A".repeat(PWNED_PASSWORDS_MAX_BYTES + 10));
    const huge = new PwnedPasswords(sha1, async () => ({ ...answer(""), body: big.body }));
    await expect(huge.timesExposed("hunter2")).rejects.toBeInstanceOf(
      PwnedPasswordsUnavailableError,
    );
    expect(big.cancel).toHaveBeenCalled();
  });

  it("asks once more after a 429 or 5xx, waiting first, then fails", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => {
      waits.push(ms);
    };
    const flaky = jest.fn(async () => answer("", 503));
    flaky.mockImplementationOnce(async () => answer("", 503));
    flaky.mockImplementationOnce(async () => answer(rangeBody({})));
    const recovers = new PwnedPasswords(sha1, flaky, { wait, spacing: 0, retryAfter: 1_000 });
    expect(await recovers.timesExposed("hunter2")).toBe(0);
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1_000]);

    // Retry-After, held to the cap.
    waits.length = 0;
    const limited = jest.fn(async () => answer("", 429, { "retry-after": "120" }));
    const busy = new PwnedPasswords(sha1, limited, { wait, spacing: 0, maxRetryAfter: 5_000 });
    await expect(busy.timesExposed("hunter2")).rejects.toBeInstanceOf(
      PwnedPasswordsUnavailableError,
    );
    expect(limited).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([5_000]);

    // Offline isn't asked again.
    const offline = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      new PwnedPasswords(sha1, offline, { wait }).timesExposed("hunter2"),
    ).rejects.toBeInstanceOf(PwnedPasswordsUnavailableError);
    expect(offline).toHaveBeenCalledTimes(1);
  });

  it("fails the checks waiting behind a failure at once, and asks again for later ones", async () => {
    const fetch = jest.fn<ReturnType<PwnedPasswordsFetch>, Parameters<PwnedPasswordsFetch>>(
      async () => {
        throw new TypeError("Failed to fetch");
      },
    );
    const client = new PwnedPasswords(sha1, fetch, { concurrency: 1, spacing: 0 });

    const waiting = ["one", "two", "three"].map((p) => client.timesExposed(p));
    for (const check of waiting) {
      await expect(check).rejects.toBeInstanceOf(PwnedPasswordsUnavailableError);
    }
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockImplementation(async () => answer(rangeBody({})));
    expect(await client.timesExposed("two")).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up on a request that takes too long", async () => {
    jest.useFakeTimers();
    try {
      const fetch: PwnedPasswordsFetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        });
      const client = new PwnedPasswords(sha1, fetch, { timeout: 10_000 });
      const check = client.timesExposed("hunter2");
      const failed = expect(check).rejects.toBeInstanceOf(PwnedPasswordsUnavailableError);
      await jest.advanceTimersByTimeAsync(10_000);
      await failed;
    } finally {
      jest.useRealTimers();
    }
  });

  it("runs a few requests at once, spaced apart", async () => {
    jest.useFakeTimers();
    try {
      let inFlight = 0;
      let mostInFlight = 0;
      const starts: number[] = [];
      const fetch: PwnedPasswordsFetch = async () => {
        starts.push(Date.now());
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 100));
        inFlight--;
        return answer(rangeBody({}));
      };
      const client = new PwnedPasswords(sha1, fetch, { concurrency: 3, spacing: 25 });

      // Twelve passwords, so twelve different prefixes (and requests).
      const passwords = Array.from({ length: 12 }, (_, i) => `password number ${i}`);
      expect(new Set(passwords.map((p) => sha1Hex(p).slice(0, 5))).size).toBe(12);
      const all = Promise.all(passwords.map((p) => client.timesExposed(p)));
      await jest.runAllTimersAsync();
      await all;

      expect(starts).toHaveLength(12);
      // Spaced 25 ms apart, 4 would overlap a 100 ms request; 3 may.
      expect(mostInFlight).toBe(3);
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(25);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  describe("calling checks off", () => {
    const passwords = Array.from({ length: 6 }, (_, i) => `queued password ${i}`);

    it("drops queued checks that were called off, so nothing more is sent for them", async () => {
      const { fetch, pending } = heldService();
      const client = new PwnedPasswords(sha1, fetch, { concurrency: 2, spacing: 0 });
      const calledOff = new AbortController();

      const checks = passwords.map((p) =>
        client.timesExposed(p, { signal: calledOff.signal }).catch((e) => e),
      );
      await settle();
      expect(fetch).toHaveBeenCalledTimes(2);

      calledOff.abort();
      const outcomes = await Promise.all(checks);
      expect(outcomes.every((e) => e instanceof PwnedPasswordsCancelledError)).toBe(true);
      // The two that were out are stopped, and the four queued never go.
      expect(pending.every((p) => p.init.signal!.aborted)).toBe(true);
      await settle();
      expect(fetch).toHaveBeenCalledTimes(2);

      // Called off isn't a failure: a new check goes out.
      const next = client.timesExposed("after");
      await settle();
      pending.at(-1)!.release();
      expect(await next).toBe(0);
    });

    it("keeps a shared request going while any check still wants it", async () => {
      const { fetch, pending } = heldService();
      const client = new PwnedPasswords(sha1, fetch);
      const first = new AbortController();

      const leaving = client.timesExposed("shared", { signal: first.signal });
      const staying = client.timesExposed("shared");
      await settle();
      expect(fetch).toHaveBeenCalledTimes(1);

      first.abort();
      await expect(leaving).rejects.toBeInstanceOf(PwnedPasswordsCancelledError);
      expect(pending[0].init.signal!.aborted).toBe(false);
      pending[0].release();
      expect(await staying).toBe(0);
    });

    it("asks an automatic check's setting just before each request, so turning it off after queueing sends nothing", async () => {
      const { fetch, pending } = heldService();
      const client = new PwnedPasswords(sha1, fetch, { concurrency: 1, spacing: 0 });
      let on = true;
      const mayAsk = jest.fn(async () => on);

      const checks = passwords.map((p) => client.timesExposed(p, { mayAsk }).catch((e) => e));
      await settle();
      expect(fetch).toHaveBeenCalledTimes(1);

      // Turned off while five wait in the queue.
      on = false;
      pending[0].release();
      const outcomes = await Promise.all(checks);
      expect(outcomes[0]).toBe(0);
      expect(outcomes.slice(1).every((e) => e instanceof PwnedPasswordsCancelledError)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mayAsk).toHaveBeenCalledTimes(passwords.length);
    });
  });
});

describe("parseRange", () => {
  it("keeps suffixes seen at least once", () => {
    const seen = "A".repeat(35);
    const range = parseRange(rangeBody({ [seen]: 3 }));
    expect(range).toEqual(new Map([[seen, 3]]));
  });
});

describe("checkPasswords", () => {
  it("checks each different password once, says how far it got, and marks the ones it couldn't check", async () => {
    const timesExposed = jest.fn(async (password: string) => {
      if (password === "offline") {
        throw new PwnedPasswordsUnavailableError();
      }
      return password === "password1" ? 9 : 0;
    });
    const progress: [number, number][] = [];

    const results = await checkPasswords(
      ["password1", "unique-and-long", "password1", "offline"],
      timesExposed,
      (checked, total) => progress.push([checked, total]),
    );

    expect(results).toEqual(
      new Map([
        ["password1", 9],
        ["unique-and-long", 0],
        ["offline", null],
      ]),
    );
    expect(timesExposed).toHaveBeenCalledTimes(3);
    expect(progress[0]).toEqual([0, 3]);
    expect(progress.at(-1)).toEqual([3, 3]);
  });

  it("passes the run's signal and setting to each check, and is called off with them", async () => {
    const calledOff = new AbortController();
    const mayAsk = async () => true;
    const timesExposed = jest.fn(async () => {
      calledOff.abort();
      throw new PwnedPasswordsCancelledError();
    });
    await expect(
      checkPasswords(["a", "b"], timesExposed, undefined, { signal: calledOff.signal, mayAsk }),
    ).rejects.toBeInstanceOf(PwnedPasswordsCancelledError);
    expect(timesExposed).toHaveBeenCalledWith(expect.any(String), {
      signal: calledOff.signal,
      mayAsk,
    });
  });

  it("asks in random order", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const orders = new Set(Array.from({ length: 5 }, () => shuffled(items).join(",")));
    expect(orders.size).toBeGreaterThan(1);
    for (const order of orders) {
      expect(
        order
          .split(",")
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual(items);
    }
  });
});
