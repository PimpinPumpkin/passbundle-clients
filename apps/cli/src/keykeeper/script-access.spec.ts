import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { Readable } from "node:stream";

import { Command } from "commander";

import { StringResponse } from "../models/response/string.response";

import { CliBrand } from "./brand";
import { scriptTokenOnCommandLine } from "./command-line";
import {
  grantedValue,
  oneTimeCode,
  openCopy,
  readScriptToken,
  scriptAuthorization,
  scriptServer,
  scriptTokenVariable,
  ScriptAnswer,
} from "./script-access";
// docs/vectors/script-access-v1.json in the meta repo; tier 1 checks the copy is the same.
import * as vectors from "./script-access.vectors.json";
import {
  firstLine,
  isScriptCommand,
  printScriptResponse,
  registerScriptCommand,
  runScriptGet,
  ScriptIo,
} from "./script-program";

const brand: CliBrand = {
  name: "PassBundle",
  command: "passbundle",
  envPrefix: "PASSBUNDLE_",
  version: "",
  releases: "",
  releaseRepository: "",
  releaseKeys: [],
  server: "https://vault.example.com",
};

const itemId = vectors.inputs.itemId;
const tokenId = vectors.inputs.tokenId;
const tokenKey = Buffer.from(vectors.tokenKey, "base64");

/** Upstream's type 2 encrypted string, as an app makes a copy. */
function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key.subarray(0, 32), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const mac = createHmac("sha256", key.subarray(32))
    .update(Buffer.concat([iv, ct]))
    .digest();
  return `2.${iv.toString("base64")}|${ct.toString("base64")}|${mac.toString("base64")}`;
}

/** A copy for the vectors' token and item, with what the test puts in it. */
const copyWith = (fields: Record<string, unknown>, item = itemId) =>
  encrypt(
    tokenKey,
    JSON.stringify({ v: 1, token: tokenId, item, revision: "2026-10-20T18:00:00.000Z", ...fields }),
  );

type Served = { status?: number; body?: unknown };

/**
 * A server that answers each path with what the test says, and keeps what
 * it was asked.
 */
function server(paths: Record<string, Served>) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fetch = async (url: string, headers: Record<string, string>): Promise<ScriptAnswer> => {
    asked.push({ url, headers });
    const path = url.replace("https://vault.example.com/api/keykeeper/script/", "");
    const served = paths[path] ?? { status: 404 };
    return { status: served.status ?? 200, json: async () => served.body };
  };
  return { fetch, asked };
}

function io(
  fetch: ScriptIo["fetch"],
  more: Partial<ScriptIo> = {},
): ScriptIo & { warned: string[] } {
  const warned: string[] = [];
  return {
    env: { PASSBUNDLE_TOKEN: vectors.tokenString },
    stdinIsTerminal: true,
    readLine: () => Promise.reject(new Error("stdin wasn't to be read")),
    stderr: { write: (s: string) => warned.push(s) },
    fetch,
    now: () => 59_000,
    warned,
    ...more,
  };
}

/** The vectors' copy, served by its id and in the token's list. */
const vectorServer = () =>
  server({
    [`items/${itemId}`]: { body: { itemId, copy: vectors.copy.encString, upToDate: true } },
    items: { body: { data: [{ itemId, copy: vectors.copy.encString, upToDate: true }] } },
  });

const get = (item: string, field: string | undefined, how: ScriptIo) =>
  runScriptGet(item, { field }, how, brand);

describe("script access in the command-line tool, against the vectors", () => {
  it("reads the token string, and derives the auth secret, the header, and the token key", () => {
    const token = readScriptToken(vectors.tokenString, brand);
    expect(token.id).toBe(tokenId);
    expect(token.secret.toString("base64url")).toBe(vectors.authSecret);
    expect(token.key.toString("base64")).toBe(vectors.tokenKey);
    expect(scriptAuthorization(token)).toBe(vectors.authorization);
    // Spaces and a line ending around it, as a variable or stdin may have.
    expect(readScriptToken(` ${vectors.tokenString}\n`, brand).id).toBe(tokenId);
    for (const bad of ["pbs1_nope", vectors.tokenString.replace("pbs1", "pbs2"), ""]) {
      expect(() => readScriptToken(bad, brand)).toThrow(
        "That isn't a PassBundle script token (it starts with pbs1_).",
      );
    }
  });

  it("opens the copy for its own token and item, and refuses the rest", () => {
    const token = readScriptToken(vectors.tokenString, brand);
    const plain = JSON.parse(vectors.copy.plaintext);
    expect(openCopy(vectors.copy.encString, token, itemId)).toEqual({
      token: plain.token,
      item: plain.item,
      revision: plain.revision,
      name: plain.name,
      username: plain.username,
      password: plain.password,
      fields: plain.fields,
    });
    // Ids as the server may write them, in capitals.
    expect(openCopy(vectors.copy.encString, token, itemId.toUpperCase()).name).toBe("Domain admin");
    for (const bad of vectors.refused) {
      expect(() => openCopy(bad.encString, token, itemId)).toThrow("integrity check");
    }
    for (const swapped of vectors.mismatched) {
      expect(() => openCopy(swapped.encString, token, itemId)).toThrow(
        "made for another token or item",
      );
    }
    expect(() => openCopy("the password in plain text", token, itemId)).toThrow("isn't a copy");
  });

  it("prints just the asked field, by the item's id or its name, sending only the token's header", async () => {
    const { fetch, asked } = vectorServer();
    const how = io(fetch);
    const value = async (item: string, field?: string) => {
      const response = await get(item, field, how);
      expect(response.message).toBeUndefined();
      expect(response.success).toBe(true);
      return (response.data as StringResponse).data;
    };
    expect(await value(itemId)).toBe("not-a-real-password-1");
    expect(await value(itemId, "username")).toBe("admin@contoso.example");
    expect(await value(itemId.toUpperCase(), "password")).toBe("not-a-real-password-1");
    expect(await value("Domain admin", "Break-glass PIN")).toBe("0000");
    // As the module does: names without regard to case.
    expect(await value("domain admin", "Password")).toBe("not-a-real-password-1");
    expect(await value("Domain admin", "break-glass pin")).toBe("0000");

    expect(asked[0].url).toBe(`https://vault.example.com/api/keykeeper/script/items/${itemId}`);
    expect(asked.map((a) => a.url)).toContain(
      "https://vault.example.com/api/keykeeper/script/items",
    );
    for (const request of asked) {
      expect(request.headers).toEqual({
        Authorization: vectors.authorization,
        Accept: "application/json",
      });
    }
    expect(how.warned).toEqual([]);
  });

  it("refuses a field the token wasn't granted, and an item it can't read", async () => {
    const { fetch } = vectorServer();
    // The vectors' grant has no one-time code.
    expect((await get(itemId, "totp", io(fetch))).message).toBe(
      "This token wasn't granted 'totp' of Domain admin.",
    );
    expect((await get(itemId, "PIN", io(fetch))).message).toBe(
      "This token wasn't granted 'PIN' of Domain admin.",
    );
    expect((await get("Wi-Fi", undefined, io(fetch))).message).toBe(
      "This token can't read an item named 'Wi-Fi'.",
    );
    expect((await get("0d1e2f3a-0000-4d6e-8f70-819a2b3c4d5e", undefined, io(fetch))).message).toBe(
      "This token can't read that item.",
    );
  });

  it("refuses an answer for another item than the one asked for", async () => {
    const other = "11111111-2222-4333-8444-555555555555";
    const { fetch } = server({
      [`items/${itemId}`]: { body: { itemId: other, copy: copyWith({ name: "Other" }, other) } },
    });
    expect((await get(itemId, undefined, io(fetch))).message).toBe(
      "The server sent a copy made for another token or item.",
    );
    // Its own copy, served under another id.
    const { fetch: swapped } = server({
      [`items/${other}`]: { body: { itemId: other, copy: vectors.copy.encString } },
    });
    expect((await get(other, undefined, io(swapped))).message).toBe(
      "The server sent a copy made for another token or item.",
    );
  });

  it("asks for an id when two items have the name", async () => {
    const second = "11111111-2222-4333-8444-555555555555";
    const { fetch } = server({
      items: {
        body: {
          data: [
            { itemId, copy: vectors.copy.encString },
            { itemId: second, copy: copyWith({ name: "DOMAIN ADMIN", password: "x" }, second) },
          ],
        },
      },
    });
    expect((await get("Domain admin", undefined, io(fetch))).message).toBe(
      "This token can read more than one item named 'Domain admin'. Ask for it by its id.",
    );
  });
});

describe("each field", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const copy = copyWith({
    name: "Router",
    username: "admin",
    password: "router-password",
    totp: secret,
    fields: {
      "Wi-Fi password": "correct horse",
      PIN: "1234",
      pin: "5678",
      ["__proto__"]: "a field named oddly",
    },
  });
  const { fetch } = server({ [`items/${itemId}`]: { body: { itemId, copy } } });
  const value = async (field: string, now = 59_000) =>
    (await get(itemId, field, io(fetch, { now: () => now }))).data as StringResponse | undefined;

  it("gives the username, the password, a current one-time code, and custom fields", async () => {
    expect((await value("username"))?.data).toBe("admin");
    expect((await value("password"))?.data).toBe("router-password");
    expect((await value("totp"))?.data).toBe(oneTimeCode(secret, 59_000));
    expect((await value("totp", 1_111_111_109_000))?.data).toBe(
      oneTimeCode(secret, 1_111_111_109_000),
    );
    expect((await value("Wi-Fi password"))?.data).toBe("correct horse");
    // A name that matches exactly wins over one that differs in case.
    expect((await value("PIN"))?.data).toBe("1234");
    expect((await value("pin"))?.data).toBe("5678");
    expect(await value("Pin")).toBeUndefined();
    // Names an item's editor chose, read as names and nothing else.
    expect((await value("__proto__"))?.data).toBe("a field named oddly");
    expect(await value("constructor")).toBeUndefined();
  });

  it("refuses what the copy doesn't have", () => {
    const opened = openCopy(
      copyWith({ name: "Bare", fields: {} }),
      readScriptToken(vectors.tokenString),
      itemId,
    );
    for (const field of ["username", "password", "totp", "notes"]) {
      expect(() => grantedValue(opened, field)).toThrow(`wasn't granted '${field}' of Bare`);
    }
  });
});

describe("one-time codes", () => {
  // RFC 6238, appendix B: 8 digits at these times, with each hash.
  const seeds = {
    SHA1: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    SHA256: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
    SHA512:
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
  };
  const rfc: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];

  it("are RFC 6238's", () => {
    for (const [seconds, ...codes] of rfc) {
      (["SHA1", "SHA256", "SHA512"] as const).forEach((algorithm, i) => {
        const address = `otpauth://totp/Test?secret=${seeds[algorithm]}&digits=8&algorithm=${algorithm}`;
        expect(oneTimeCode(address, seconds * 1000)).toBe(codes[i]);
      });
    }
  });

  it("come from a plain secret too: 6 digits, SHA-1, 30 seconds, lower case and spaces allowed", () => {
    expect(oneTimeCode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59_000)).toBe("287082");
    expect(
      oneTimeCode("otpauth://totp/x?period=60&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000),
    ).toBe(oneTimeCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 0));
  });

  it("refuse Steam's, and secrets and settings that aren't ones", () => {
    expect(() => oneTimeCode("steam://JBSWY3DPEHPK3PXP")).toThrow("Steam");
    expect(() => oneTimeCode("not base32!")).toThrow("isn't base32");
    expect(() => oneTimeCode("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0")).toThrow(
      "settings",
    );
    expect(() => oneTimeCode("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=11")).toThrow(
      "settings",
    );
  });
});

describe("where the token comes from", () => {
  it("is the brand's variable, without a word on stderr", async () => {
    // The PowerShell module's name, so one RMM variable serves both.
    expect(scriptTokenVariable(brand)).toBe("PASSBUNDLE_TOKEN");
    const how = io(vectorServer().fetch);
    expect((await get(itemId, undefined, how)).success).toBe(true);
    expect(how.warned).toEqual([]);
  });

  it("is otherwise the first line on stdin, when it isn't a terminal", async () => {
    const how = io(vectorServer().fetch, {
      env: {},
      stdinIsTerminal: false,
      readLine: async () => `${vectors.tokenString}\r`,
    });
    expect((await get(itemId, undefined, how)).success).toBe(true);
    expect(how.warned).toEqual([]);
  });

  it("is never a terminal's stdin, and says where to put it", async () => {
    // The name this command once had is nothing to it.
    for (const env of [
      {},
      { PASSBUNDLE_TOKEN: "  " },
      { PASSBUNDLE_SCRIPT_TOKEN: vectors.tokenString },
    ]) {
      const response = await get(itemId, undefined, io(vectorServer().fetch, { env }));
      expect(response.message).toBe("No script token: set PASSBUNDLE_TOKEN, or give it on stdin.");
    }
    const empty = io(vectorServer().fetch, {
      env: {},
      stdinIsTerminal: false,
      readLine: async () => "",
    });
    expect((await get(itemId, undefined, empty)).message).toContain("No script token");
  });

  it("is read from the command line only with --token, which warns on stderr", async () => {
    const run = async (args: string[]) => {
      const how = io(vectorServer().fetch, { env: {} });
      const program = new Command().exitOverride();
      registerScriptCommand(program, () => how, brand);
      await program.parseAsync(args, { from: "user" });
      return how;
    };
    const exitCode = process.exitCode;
    const out = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const given = await run(["script", "get", itemId, "--token", vectors.tokenString]);
      expect(out.mock.lastCall![0]).toMatch(/^not-a-real-password-1\n?$/);
      expect(given.warned).toEqual([scriptTokenOnCommandLine(brand) + "\n"]);
      expect(scriptTokenOnCommandLine(brand)).toContain("Set PASSBUNDLE_TOKEN instead");

      // A token anywhere else on the command line is only an argument: never read as one.
      out.mockClear();
      const elsewhere = await run(["script", "get", vectors.tokenString]);
      expect(out).not.toHaveBeenCalled();
      expect(err.mock.lastCall![0]).toContain("No script token");
      expect(elsewhere.warned).toEqual([]);
    } finally {
      out.mockRestore();
      err.mockRestore();
      process.exitCode = exitCode;
    }
  });

  it("reads one line from stdin and no more", async () => {
    expect(await firstLine(Readable.from([`${vectors.tokenString}\nsomething else\n`]))).toBe(
      vectors.tokenString,
    );
    expect(await firstLine(Readable.from(["pbs1_", "abc"]))).toBe("pbs1_abc");
  });
});

describe("what the server says", () => {
  it("names a revoked or expired token, a token at its limit, and a server that isn't there", async () => {
    const refused = await get(
      itemId,
      undefined,
      io(server({ [`items/${itemId}`]: { status: 401 } }).fetch),
    );
    expect(refused.success).toBe(false);
    expect(refused.message).toBe(
      "The server refused the token: it was revoked or expired, whoever made it no longer manages " +
        "the organization, it was mistyped, or it was used from a network it isn't allowed on.",
    );
    expect(
      (await get(itemId, undefined, io(server({ [`items/${itemId}`]: { status: 429 } }).fetch)))
        .message,
    ).toBe("Too many reads with this token; try again in a minute.");
    expect(
      (await get(itemId, undefined, io(server({ [`items/${itemId}`]: { status: 302 } }).fetch)))
        .message,
    ).toBe("Couldn't reach PassBundle at https://vault.example.com: it answered 302.");
    const down = io(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect((await get(itemId, undefined, down)).message).toBe(
      "Couldn't reach PassBundle at https://vault.example.com: connect ECONNREFUSED",
    );
  });
});

describe("the server it asks", () => {
  it("is the one named, or the brand's own, over https only", () => {
    expect(scriptServer(undefined, brand)).toBe("https://vault.example.com");
    expect(scriptServer("https://vault.contoso.example/", brand)).toBe(
      "https://vault.contoso.example",
    );
    expect(scriptServer("https://contoso.example/vault/", brand)).toBe(
      "https://contoso.example/vault",
    );
    expect(() => scriptServer("http://vault.contoso.example", brand)).toThrow(
      "isn't an https address",
    );
    expect(() => scriptServer("vault.contoso.example", brand)).toThrow("isn't a server's address");
    expect(() => scriptServer(undefined, { ...brand, server: "" })).toThrow(
      "Say which server: --server or PASSBUNDLE_SERVER.",
    );
  });

  it("comes from --server, or else the brand's variable", async () => {
    const asked: string[] = [];
    const fetch = async (url: string): Promise<ScriptAnswer> => {
      asked.push(url);
      return { status: 401, json: async () => ({}) };
    };
    await runScriptGet(
      itemId,
      {},
      io(fetch, { env: { ...io(fetch).env, PASSBUNDLE_SERVER: "https://a.example" } }),
      brand,
    );
    await runScriptGet(
      itemId,
      { server: "https://b.example" },
      io(fetch, { env: { ...io(fetch).env, PASSBUNDLE_SERVER: "https://a.example" } }),
      brand,
    );
    expect(asked).toEqual([
      `https://a.example/api/keykeeper/script/items/${itemId}`,
      `https://b.example/api/keykeeper/script/items/${itemId}`,
    ]);
  });
});

describe("the command line", () => {
  it("runs `script` without the rest of the tool, after options without a value only", () => {
    expect(isScriptCommand(["node", "passbundle", "script", "get", "x"])).toBe(true);
    expect(isScriptCommand(["node", "passbundle", "--response", "--quiet", "script", "get"])).toBe(
      true,
    );
    expect(isScriptCommand(["node", "passbundle", "get", "script"])).toBe(false);
    expect(isScriptCommand(["node", "passbundle", "--session", "script", "get"])).toBe(false);
    expect(isScriptCommand(["node", "passbundle"])).toBe(false);
  });

  it("prints the value alone, or JSON with --response, and an error's exit code unless --cleanexit", async () => {
    const exitCode = process.exitCode;
    const out = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const ok = await get(itemId, "username", io(vectorServer().fetch));
      printScriptResponse(ok, {});
      expect(out.mock.lastCall![0]).toMatch(/^admin@contoso\.example\n?$/);
      expect(process.exitCode).toBe(0);
      printScriptResponse(ok, { BW_RESPONSE: "true" });
      expect(JSON.parse(out.mock.lastCall![0] as string)).toEqual({
        success: true,
        data: { object: "string", data: "admin@contoso.example" },
      });
      out.mockClear();
      printScriptResponse(ok, { BW_QUIET: "true" });
      expect(out).not.toHaveBeenCalled();

      const refused = await get("Wi-Fi", undefined, io(vectorServer().fetch));
      printScriptResponse(refused, {});
      expect(err.mock.lastCall![0]).toContain("This token can't read an item named 'Wi-Fi'.");
      expect(process.exitCode).toBe(1);
      printScriptResponse(refused, { BW_CLEANEXIT: "true" });
      expect(process.exitCode).toBe(0);
    } finally {
      out.mockRestore();
      err.mockRestore();
      process.exitCode = exitCode;
    }
  });
});
