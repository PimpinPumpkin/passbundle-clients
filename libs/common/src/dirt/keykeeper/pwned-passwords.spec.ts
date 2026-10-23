import { createHash } from "crypto";

import {
  checkPasswords,
  parseRange,
  PWNED_PASSWORDS_RANGE_URL,
  PwnedPasswords,
  PwnedPasswordsFetch,
  PwnedPasswordsResponse,
  PwnedPasswordsUnavailableError,
} from "./pwned-passwords";

const sha1 = async (text: string) => new Uint8Array(createHash("sha1").update(text).digest());
const sha1Hex = (text: string) => createHash("sha1").update(text).digest("hex").toUpperCase();

/** A padded range answer: decoys seen 0 times, plus the given suffixes. */
function rangeBody(entries: Record<string, number>, lineEnd = "\r\n"): string {
  const lines = [
    "0018A45C4D1DEF81644B54AB7F969B88D65:0",
    "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0",
    ...Object.entries(entries).map(([suffix, count]) => `${suffix}:${count}`),
    "011053FD0102E94D6AE2F8B83D76FAF94F6:0",
  ];
  return lines.join(lineEnd);
}

function ok(body: string): PwnedPasswordsResponse {
  return { ok: true, status: 200, text: async () => body };
}

type Call = { url: string; init: RequestInit };

/** A range API that knows the given passwords and how often each was seen. */
function serviceKnowing(seen: Record<string, number>) {
  const calls: Call[] = [];
  const bySuffix = new Map(
    Object.entries(seen).map(([password, count]) => [sha1Hex(password), count] as const),
  );
  const fetch = jest.fn<ReturnType<PwnedPasswordsFetch>, Parameters<PwnedPasswordsFetch>>(
    async (url, init) => {
      calls.push({ url, init });
      const prefix = url.slice(PWNED_PASSWORDS_RANGE_URL.length);
      const entries: Record<string, number> = {};
      for (const [hash, count] of bySuffix) {
        if (hash.startsWith(prefix)) {
          entries[hash.slice(5)] = count;
        }
      }
      return ok(rangeBody(entries));
    },
  );
  return { fetch, calls };
}

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
    // Nothing else about the password goes anywhere.
    const sent = url + JSON.stringify({ ...init, signal: undefined });
    expect(sent).not.toContain(password);
    expect(sent).not.toContain(hash.slice(5));
    expect(sent).not.toContain(hash.slice(5).toLowerCase());
  });

  it("matches the suffix in the answer, whatever its case and line endings, and answers 0 when it isn't there", async () => {
    const hash = sha1Hex("hunter2");
    const answers = [
      rangeBody({ [hash.slice(5).toLowerCase()]: 17 }, "\n"),
      rangeBody({ [hash.slice(5)]: 17 }, "\r\n"),
    ];
    for (const body of answers) {
      const client = new PwnedPasswords(sha1, async () => ok(body));
      expect(await client.timesExposed("hunter2")).toBe(17);
    }
    const missing = new PwnedPasswords(sha1, async () => ok(rangeBody({})));
    expect(await missing.timesExposed("hunter2")).toBe(0);
  });

  it("counts a padding entry (seen 0 times) as not exposed", async () => {
    const hash = sha1Hex("hunter2");
    const client = new PwnedPasswords(sha1, async () => ok(rangeBody({ [hash.slice(5)]: 0 })));
    expect(await client.timesExposed("hunter2")).toBe(0);
  });

  it("asks once per password for the session, and again after forgetting", async () => {
    const { fetch } = serviceKnowing({ password1: 2_000_000 });
    const client = new PwnedPasswords(sha1, fetch);

    const first = await Promise.all([
      client.timesExposed("password1"),
      client.timesExposed("password1"),
    ]);
    expect(first).toEqual([2_000_000, 2_000_000]);
    expect(await client.timesExposed("password1")).toBe(2_000_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    client.forget();
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
    const fetch = jest.fn(async () => ok(rangeBody({ ["1".repeat(35)]: 5 })));
    const client = new PwnedPasswords(fakeSha1, fetch);

    expect(await Promise.all([client.timesExposed("a"), client.timesExposed("b")])).toEqual([5, 0]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails, instead of answering 0, when the service is unreachable, refuses, or answers with something else", async () => {
    const failures: PwnedPasswordsFetch[] = [
      async () => {
        throw new TypeError("Failed to fetch");
      },
      async () => ({ ok: false, status: 503, text: async () => "" }),
      async () => ({ ok: false, status: 429, text: async () => "" }),
      async () => ok("<html><body>Sign in to the guest Wi-Fi</body></html>"),
    ];
    for (const fetch of failures) {
      const client = new PwnedPasswords(sha1, fetch);
      await expect(client.timesExposed("hunter2")).rejects.toBeInstanceOf(
        PwnedPasswordsUnavailableError,
      );
    }
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

    fetch.mockImplementation(async () => ok(rangeBody({})));
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
        return ok(rangeBody({}));
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
});

describe("parseRange", () => {
  it("keeps suffixes seen at least once, uppercased", () => {
    expect(parseRange("abc:3\r\nDEF:0\r\n\r\n0A1:12")).toEqual(
      new Map([
        ["ABC", 3],
        ["0A1", 12],
      ]),
    );
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
});
