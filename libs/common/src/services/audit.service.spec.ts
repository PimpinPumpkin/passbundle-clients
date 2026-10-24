import { createHash } from "crypto";

import { ApiService } from "../abstractions/api.service";
import { HibpApiService } from "../dirt/services/hibp-api.service";
import { CryptoFunctionService } from "../key-management/crypto/abstractions/crypto-function.service";

import { AuditService } from "./audit.service";

jest.useFakeTimers();

// Polyfill global Request for Jest environment if not present
if (typeof global.Request === "undefined") {
  global.Request = jest.fn((input: string | URL, init?: RequestInit) => {
    return { url: typeof input === "string" ? input : input.toString(), ...init };
  }) as any;
}

describe("AuditService", () => {
  let auditService: AuditService;
  let mockCrypto: jest.Mocked<CryptoFunctionService>;
  let mockApi: jest.Mocked<ApiService>;
  let mockHibpApi: jest.Mocked<HibpApiService>;

  beforeEach(() => {
    // Keykeeper: real SHA-1, and an answer padded the way the service pads
    // (the client refuses one too short to be the service's).
    mockCrypto = {
      hash: jest.fn(
        async (text: string) => new Uint8Array(createHash("sha1").update(text).digest()),
      ),
    } as unknown as jest.Mocked<CryptoFunctionService>;
    const padding = Array.from(
      { length: 200 },
      (_, i) => `${createHash("sha1").update(`decoy ${i}`).digest("hex").toUpperCase().slice(5)}:0`,
    );
    // SHA-1("password") is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
    const body = [...padding, "1E4C9B93F3F0682250B6CF8331B7EE68FD8:4"].join("\r\n");

    mockApi = {
      nativeFetch: jest.fn().mockImplementation(async () => ({
        status: 200,
        headers: { get: (): string | null => null },
        text: jest.fn().mockResolvedValue(body),
      })),
    } as unknown as jest.Mocked<ApiService>;

    mockHibpApi = {
      getHibpBreach: jest.fn(),
    } as unknown as jest.Mocked<HibpApiService>;

    auditService = new AuditService(mockCrypto, mockApi, mockHibpApi, 2);
  });

  it("should not exceed max concurrent passwordLeaked requests", async () => {
    const inFlight: string[] = [];
    const maxInFlight: number[] = [];

    // Patch fetchLeakedPasswordCount to track concurrency
    const origFetch = (auditService as any).fetchLeakedPasswordCount.bind(auditService);
    jest
      .spyOn(auditService as any, "fetchLeakedPasswordCount")
      .mockImplementation(async (password: string) => {
        inFlight.push(password);
        maxInFlight.push(inFlight.length);
        // Simulate async work to allow concurrency limiter to take effect
        await new Promise((resolve) => setTimeout(resolve, 100));
        inFlight.splice(inFlight.indexOf(password), 1);
        return origFetch(password);
      });

    const p1 = auditService.passwordLeaked("password1");
    const p2 = auditService.passwordLeaked("password2");
    const p3 = auditService.passwordLeaked("password3");
    const p4 = auditService.passwordLeaked("password4");

    jest.advanceTimersByTime(250);

    // Flush all pending timers and microtasks
    await jest.runAllTimersAsync();
    await Promise.all([p1, p2, p3, p4]);

    // The max value in maxInFlight should not exceed 2 (the concurrency limit)
    expect(Math.max(...maxInFlight)).toBeLessThanOrEqual(2);
    expect((auditService as any).fetchLeakedPasswordCount).toHaveBeenCalledTimes(4);
    expect(mockCrypto.hash).toHaveBeenCalledTimes(4);
    expect(mockApi.nativeFetch).toHaveBeenCalledTimes(4);
  });

  it("should include Add-Padding header when checking leaked passwords", async () => {
    const result = await auditService.passwordLeaked("password");

    expect(result).toBe(4);
    expect(mockApi.nativeFetch).toHaveBeenCalledTimes(1);
    const request = mockApi.nativeFetch.mock.calls[0][0] as any;
    expect(request.url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    expect(request.headers).toEqual(expect.objectContaining({ "Add-Padding": "true" }));
  });

  // Keykeeper: no hash of any password (a master password included) is kept,
  // so asking again asks the service again.
  it("keeps nothing about a checked password", async () => {
    for (let i = 0; i < 2; i++) {
      const check = auditService.passwordLeaked("password");
      // Past the client's spacing between requests.
      await jest.runAllTimersAsync();
      expect(await check).toBe(4);
    }
    expect(mockApi.nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("should return empty array for breachedAccounts when no breaches found", async () => {
    // Server returns 200 with empty array (correct REST semantics)
    mockHibpApi.getHibpBreach.mockResolvedValueOnce([]);
    const result = await auditService.breachedAccounts("user@example.com");
    expect(result).toEqual([]);
  });

  it("should propagate errors from breachedAccounts", async () => {
    const error = new Error("API error");
    mockHibpApi.getHibpBreach.mockRejectedValueOnce(error);
    await expect(auditService.breachedAccounts("user@example.com")).rejects.toBe(error);
  });
});
