import { checkServer, serverConfigUrl } from "./server-check";

/** An answer as a server would send it. */
function answer(status: number, body: string, type = "application/json; charset=utf-8") {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? type : null) },
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const settings = JSON.stringify({
  version: "2026.6.0",
  server: { name: "PassBundle", url: "https://github.com/PimpinPumpkin/passbundle-server" },
  environment: { vault: "https://vault.example.com" },
  object: "config",
});

describe("checkServer", () => {
  it("asks the address for its settings, and nothing else", async () => {
    const fetch = jest.fn(async () => answer(200, settings));

    expect(await checkServer("https://vault.example.com", fetch)).toEqual({ ok: true });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://vault.example.com/api/config");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
  });

  it("finds the settings under a server's path", () => {
    expect(serverConfigUrl("https://example.com/vault/")).toBe(
      "https://example.com/vault/api/config",
    );
    expect(serverConfigUrl("https://vault.example.com:8443")).toBe(
      "https://vault.example.com:8443/api/config",
    );
  });

  it("says no server answered when nothing did", async () => {
    const fetch = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await checkServer("https://vualt.example.com", fetch)).toEqual({
      ok: false,
      problem: "unreachable",
    });
  });

  it("stops waiting, and says so, when the answer doesn't come in time", async () => {
    const fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    expect(await checkServer("https://slow.example.com", fetch, 10)).toEqual({
      ok: false,
      problem: "slow",
    });
  });

  it("says it isn't a server for a website, a missing page, or other settings", async () => {
    for (const reply of [
      answer(200, "<!doctype html><title>Parked</title>", "text/html"),
      answer(404, JSON.stringify({ message: "Not found" })),
      answer(200, JSON.stringify({ object: "something" })),
      answer(200, JSON.stringify({ object: "config" })),
      answer(200, "not json"),
    ]) {
      expect(await checkServer("https://example.com", async () => reply)).toEqual({
        ok: false,
        problem: "notAServer",
      });
    }
  });

  it("says the server had a problem when it, or a proxy before it, answers with one", async () => {
    expect(
      await checkServer("https://vault.example.com", async () =>
        answer(502, "<html>Bad gateway</html>", "text/html"),
      ),
    ).toEqual({ ok: false, problem: "broken" });
  });
});
