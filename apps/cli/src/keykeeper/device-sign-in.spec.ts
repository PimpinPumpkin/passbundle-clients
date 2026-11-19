// Keykeeper: `passbundle login --device` (device-sign-in.ts and
// login.command.ts): the phrase first, the wait, and signing in with the
// approval, with upstream's AuthRequestService against the device approval
// test vectors (the meta repo's docs/vectors/device-approval-v1.json, copied
// in libs/auth; tier 1 checks the copy).

import * as fs from "fs";
import * as path from "path";

import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import {
  AuthRequestLoginCredentials,
  AuthRequestService,
  AuthRequestServiceAbstraction,
  DefaultAuthRequestApiService,
  LoginStrategyServiceAbstraction,
  SsoUrlService,
  UserDecryptionOptionsServiceAbstraction,
} from "@bitwarden/auth/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { TwoFactorProviderType } from "@bitwarden/common/auth/enums/two-factor-provider-type";
import { AuthResult } from "@bitwarden/common/auth/models/domain/auth-result";
import { ForceSetPasswordReason } from "@bitwarden/common/auth/models/domain/force-set-password-reason";
import { TwoFactorApiService, TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { EncryptedMigrator } from "@bitwarden/common/key-management/encrypted-migrator/encrypted-migrator.abstraction";
import { KeyConnectorService } from "@bitwarden/common/key-management/key-connector/abstractions/key-connector.service";
import { MasterPasswordServiceAbstraction } from "@bitwarden/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { FakeMasterPasswordService } from "@bitwarden/common/key-management/master-password/services/fake-master-password.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { AppIdService } from "@bitwarden/common/platform/abstractions/app-id.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { SdkLoadService } from "@bitwarden/common/platform/abstractions/sdk/sdk-load.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";
import { PasswordGenerationServiceAbstraction } from "@bitwarden/generator-legacy";
import { KdfConfigService, KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import {
  CryptoFunctionService,
  DefaultLegacyCompatKeyService,
  EncryptService,
  KeyGenerationService,
  SymmetricCryptoKey,
} from "@bitwarden/legacy-crypto";
// eslint-disable-next-line no-restricted-imports
import { NodeCryptoFunctionService } from "@bitwarden/legacy-crypto/node";
import { PureCrypto } from "@bitwarden/sdk-internal";
import { UnlockService } from "@bitwarden/unlock";

import { LoginCommand } from "../auth/commands/login.command";
import { MessageResponse } from "../models/response/message.response";

import {
  DeviceAnswer,
  DeviceWaitDeps,
  ENDED,
  EXPIRED,
  phraseLines,
  pollDelay,
  REQUEST_LIFETIME_MS,
  STOPPED,
  TOO_MANY_DELAY_MS,
  TooManyRequests,
  UNKNOWN_DEVICE,
  waitForApproval,
} from "./device-sign-in";

const vectors = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../../../libs/auth/src/common/services/auth-request/keykeeper-device-approval.vectors.json",
    ),
    "utf8",
  ),
);
const NULL = null as unknown as string;
const bytes = (b64: string) => Utils.fromB64ToArray(b64);
const DANA = vectors.fingerprints[0];

/** A clock the wait's sleeps move, and its sleeps. */
function clock(start = 1_000_000) {
  const state = { now: start, slept: [] as number[] };
  return {
    state,
    now: () => state.now,
    sleep: async (ms: number) => {
      state.slept.push(ms);
      state.now += ms;
    },
  };
}

describe("waiting for another device's approval", () => {
  let time: ReturnType<typeof clock>;
  let answers: (DeviceAnswer | null | Error)[];
  let stop: AbortController;
  let deps: DeviceWaitDeps;
  let privateKey: Uint8Array;

  beforeEach(() => {
    time = clock();
    answers = [];
    stop = new AbortController();
    privateKey = new Uint8Array([1, 2, 3, 4]);
    deps = {
      answer: async () => {
        const next = answers.length > 0 ? answers.shift()! : { requestApproved: null };
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
      write: jest.fn(),
      sleep: time.sleep,
      now: time.now,
      stopped: stop.signal,
    };
  });

  it("says the phrase first, then to approve only where the same phrase shows", () => {
    const lines = phraseLines("caretaker-uncaring-constrain-rind-dove", "passbundle");
    expect(lines[0]).toBe("Fingerprint phrase: caretaker-uncaring-constrain-rind-dove");
    expect(lines[1]).toContain("only if that device shows this same phrase");
    expect(lines[1]).toContain("only if you started this sign-in yourself");
    expect(lines[2]).toContain("up to 15 minutes. Press Ctrl-C to stop");
  });

  it("asks every 5 seconds for 2 minutes, then every 20, about 60 times in 15 minutes", () => {
    expect(pollDelay(0)).toBe(5_000);
    expect(pollDelay(119_999)).toBe(5_000);
    expect(pollDelay(120_000)).toBe(20_000);
    let asked = 0;
    for (let t = 0; t < REQUEST_LIFETIME_MS; t += pollDelay(t)) {
      asked++;
    }
    expect(asked).toBeLessThanOrEqual(64);
  });

  it("gives the wrapped key once it's approved, and keeps the private key for opening it", async () => {
    answers = [
      { requestApproved: null },
      { requestApproved: null },
      { requestApproved: true, key: "4.wrapped" },
    ];
    expect(await waitForApproval(time.now(), privateKey, deps)).toEqual({ key: "4.wrapped" });
    expect(time.state.slept).toEqual([5_000, 5_000, 5_000]);
    expect([...privateKey]).toEqual([1, 2, 3, 4]);
  });

  it("ends at a denial, and overwrites the private key", async () => {
    answers = [{ requestApproved: false, responseDate: "2026-11-18T10:00:00Z" }];
    expect(await waitForApproval(time.now(), privateKey, deps)).toEqual({ error: ENDED });
    expect([...privateKey]).toEqual([0, 0, 0, 0]);
  });

  it("ends when the server no longer has the request (denied, expired, or replaced)", async () => {
    answers = [{ requestApproved: null }, null];
    expect(await waitForApproval(time.now(), privateKey, deps)).toEqual({ error: ENDED });
    expect([...privateKey]).toEqual([0, 0, 0, 0]);
  });

  it("ends at an approval without a key", async () => {
    answers = [{ requestApproved: true, key: null }];
    expect(await waitForApproval(time.now(), privateKey, deps)).toEqual({ error: ENDED });
  });

  it("ends after 15 minutes, never asking past them", async () => {
    const started = time.now();
    const result = await waitForApproval(started, privateKey, deps);
    expect(result).toEqual({ error: EXPIRED });
    expect(time.now() - started).toBe(REQUEST_LIFETIME_MS);
    expect([...privateKey]).toEqual([0, 0, 0, 0]);
  });

  it("waits a minute after too many requests, and asks again after a network failure", async () => {
    answers = [
      new TooManyRequests(),
      new Error("ECONNRESET"),
      { requestApproved: true, key: "4.k" },
    ];
    expect(await waitForApproval(time.now(), privateKey, deps)).toEqual({ key: "4.k" });
    // 65 seconds in, still in the first 2 minutes: 5 seconds again.
    expect(time.state.slept).toEqual([5_000, TOO_MANY_DELAY_MS, 5_000]);
  });

  it("stops at Ctrl-C, and overwrites the private key", async () => {
    deps.answer = async () => {
      stop.abort();
      return { requestApproved: null };
    };
    expect(await waitForApproval(time.now(), privateKey, deps)).toEqual({ error: STOPPED });
    expect([...privateKey]).toEqual([0, 0, 0, 0]);
  });

  it("stops at Ctrl-C during a wait, before asking again", async () => {
    let asked = 0;
    deps.answer = async () => {
      asked++;
      return { requestApproved: null };
    };
    deps.sleep = async () => {
      if (asked === 2) {
        stop.abort();
      }
    };
    expect(await waitForApproval(time.now(), privateKey, deps)).toEqual({ error: STOPPED });
    expect(asked).toBe(2);
  });
});

describe("login --device", () => {
  const accountService = mockAccountServiceWith(Utils.newGuid() as UserId);
  // Upstream's AuthRequestService, with the real phrase (hashing and HKDF)
  // and the real unwrapping (the SDK's RSA-OAEP).
  const legacyCompatKeyService = new DefaultLegacyCompatKeyService(
    mock<KeyGenerationService>(),
    new NodeCryptoFunctionService(),
    mock<EncryptService>(),
    mock<LogService>(),
    accountService,
    mock<KdfConfigService>(),
    mock<KeyService>(),
  );
  const encryptService = mock<EncryptService>();
  encryptService.decapsulateKeyUnsigned.mockImplementation(async (wrapped, privateKey) => {
    return new SymmetricCryptoKey(
      PureCrypto.decapsulate_key_unsigned(wrapped.encryptedString!, privateKey),
    );
  });
  const authRequestService = new AuthRequestService(
    mock<AppIdService>(),
    new FakeMasterPasswordService(),
    mock<KeyService>(),
    legacyCompatKeyService,
    encryptService,
    mock<ApiService>(),
    new FakeStateProvider(accountService),
    mock<DefaultAuthRequestApiService>(),
    accountService,
    mock<UnlockService>(),
  );

  let command: LoginCommand;
  let apiService: MockProxy<ApiService>;
  let loginStrategyService: MockProxy<LoginStrategyServiceAbstraction>;
  let cryptoFunctionService: MockProxy<CryptoFunctionService>;
  let twoFactorService: MockProxy<TwoFactorService>;
  let twoFactorApiService: MockProxy<TwoFactorApiService>;
  let stderr: string[];
  let generatedPrivateKey: Uint8Array;
  const saved = { noInteraction: process.env.BW_NOINTERACTION, session: process.env.BW_SESSION };

  const success = () => {
    const result = new AuthResult();
    result.userId = "user-id" as UserId;
    return result;
  };

  beforeEach(() => {
    process.env.BW_NOINTERACTION = "true";
    stderr = [];
    jest.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
      stderr.push(String(s));
      return true;
    });
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    Object.defineProperty(SdkLoadService, "Ready", {
      value: Promise.resolve(),
      configurable: true,
    });
    jest.spyOn(PureCrypto, "make_aes256_cbc_hmac_key").mockReturnValue({} as any);
    jest
      .spyOn(SymmetricCryptoKey, "fromSdk")
      .mockReturnValue({ toBase64: () => "c2Vzc2lvbg==" } as SymmetricCryptoKey);

    apiService = mock<ApiService>();
    loginStrategyService = mock<LoginStrategyServiceAbstraction>();
    loginStrategyService.logIn.mockResolvedValue(success());
    cryptoFunctionService = mock<CryptoFunctionService>();
    // The vectors' request key pair, as if the tool had just made it.
    generatedPrivateKey = bytes(vectors.request.privateKey);
    cryptoFunctionService.rsaGenerateKeyPair.mockResolvedValue([
      bytes(vectors.request.publicKey),
      generatedPrivateKey,
    ] as any);
    twoFactorService = mock<TwoFactorService>();
    twoFactorApiService = mock<TwoFactorApiService>();
    const appIdService = mock<AppIdService>();
    appIdService.getAppId.mockResolvedValue("device-1");
    const keyConnectorService = mock<KeyConnectorService>();
    keyConnectorService.requiresDomainConfirmation$.mockReturnValue(of(null));
    keyConnectorService.getUsesKeyConnector.mockResolvedValue(false);
    const masterPasswordService = mock<MasterPasswordServiceAbstraction>();
    masterPasswordService.forceSetPasswordReason$.mockReturnValue(of(ForceSetPasswordReason.None));
    const authService = mock<AuthService>();
    authService.authStatusFor$.mockReturnValue(of(AuthenticationStatus.Unlocked));
    const accounts = mock<AccountService>();
    accounts.activeAccount$ = of({ id: "user-id" } as any);
    const environmentService = mock<EnvironmentService>();
    environmentService.environment$ = of({
      getWebVaultUrl: () => "https://vault.example.test",
    } as any);

    command = new LoginCommand(
      loginStrategyService,
      authService,
      twoFactorApiService,
      cryptoFunctionService,
      environmentService,
      mock<PasswordGenerationServiceAbstraction>(),
      mock<PlatformUtilsService>(),
      accounts,
      twoFactorService,
      mock<SyncService>(),
      keyConnectorService,
      jest.fn(),
      mock<SsoUrlService>(),
      mock<I18nService>(),
      masterPasswordService,
      mock<UserDecryptionOptionsServiceAbstraction>(),
      mock<EncryptedMigrator>(),
      apiService,
      // Upstream's class, whose declarations differ from its abstraction's under strict checks.
      authRequestService as unknown as AuthRequestServiceAbstraction,
      appIdService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.BW_NOINTERACTION = saved.noInteraction;
    if (saved.session === undefined) {
      delete process.env.BW_SESSION;
    } else {
      process.env.BW_SESSION = saved.session;
    }
  });

  /** The server: the request, then each answer in turn. */
  function server(...answers: (Record<string, unknown> | ErrorResponse)[]) {
    apiService.send.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/auth-requests/") {
        return { Id: "request-1", CreationDate: "2026-11-18T10:00:00Z" };
      }
      if (method === "GET" && path.startsWith("/auth-requests/request-1/response?code=")) {
        const next = answers.length > 1 ? answers.shift()! : answers[0];
        if (next instanceof ErrorResponse) {
          throw next;
        }
        return next;
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
  }

  /** Runs the command while its waits pass. */
  async function run(options: Record<string, unknown> = { device: true }, email = DANA.email) {
    let done = false;
    const running = command.run(email, NULL, options).finally(() => (done = true));
    for (let i = 0; i < 400 && !done; i++) {
      await jest.advanceTimersByTimeAsync(5_000);
    }
    return await running;
  }

  it("prints the phrase first, waits, and signs in with the approval's user key and the access code", async () => {
    server({ RequestApproved: null }, { RequestApproved: true, Key: vectors.approval.key });
    const response = await run();
    expect(response.success).toBe(true);
    expect((response.data as MessageResponse).title).toBe("You are logged in!");

    // The request: type 0, this device, the public key, 25 letters and digits.
    const [, , request] = apiService.send.mock.calls[0];
    expect(request).toMatchObject({
      email: DANA.email,
      deviceIdentifier: "device-1",
      publicKey: vectors.request.publicKey,
      type: 0,
    });
    const accessCode = (request as { accessCode: string }).accessCode;
    expect(accessCode).toMatch(/^[A-Za-z0-9]{25}$/);
    // Its answer, read with the access code.
    expect(apiService.send.mock.calls[1][1]).toBe(
      `/auth-requests/request-1/response?code=${accessCode}`,
    );

    // The phrase, the vectors' for this email and key, before anything else, on stderr.
    expect(stderr[0]).toBe(`Fingerprint phrase: ${DANA.phrase}\n`);
    expect(stderr[1]).toContain("only if that device shows this same phrase");

    // Signed in with upstream's auth request sign-in: the access code and the
    // request, and the user key the vectors' approval wraps.
    const credentials = loginStrategyService.logIn.mock.calls[0][0] as AuthRequestLoginCredentials;
    expect(credentials).toBeInstanceOf(AuthRequestLoginCredentials);
    expect(credentials.email).toBe(DANA.email);
    expect(credentials.accessCode).toBe(accessCode);
    expect(credentials.authRequestId).toBe("request-1");
    expect(Utils.fromBufferToB64(credentials.decryptedUserKey!.toEncoded())).toBe(
      vectors.approval.userKey,
    );
    // The private key is overwritten once it's opened the key.
    expect(generatedPrivateKey.every((b) => b === 0)).toBe(true);
  });

  it("makes the same phrase for the same email typed with capitals", async () => {
    server({ RequestApproved: true, Key: vectors.approval.key });
    await run({ device: true }, vectors.fingerprints[1].email);
    expect(stderr[0]).toBe(`Fingerprint phrase: ${vectors.fingerprints[1].phrase}\n`);
    expect(vectors.fingerprints[1].phrase).toBe(DANA.phrase);
  });

  it("signs nothing in when the request is denied", async () => {
    server(
      { RequestApproved: null },
      new ErrorResponse({ Message: "AuthRequest doesn't exist" }, 400),
    );
    const response = await run();
    expect(response).toMatchObject({ success: false, message: ENDED });
    expect(loginStrategyService.logIn).not.toHaveBeenCalled();
    expect(generatedPrivateKey.every((b) => b === 0)).toBe(true);
  });

  it("signs nothing in when nobody approves within 15 minutes", async () => {
    server({ RequestApproved: null });
    const response = await run();
    expect(response).toMatchObject({ success: false, message: EXPIRED });
    expect(loginStrategyService.logIn).not.toHaveBeenCalled();
  });

  it("says to sign in once first on a computer the account doesn't know", async () => {
    apiService.send.mockRejectedValue(
      new ErrorResponse({ Message: "AuthRequest doesn't exist" }, 400),
    );
    const response = await run();
    expect(response).toMatchObject({ success: false, message: UNKNOWN_DEVICE });
    expect(stderr).toEqual([]);
    expect(generatedPrivateKey.every((b) => b === 0)).toBe(true);
  });

  it("prints the server's message when it refuses the request", async () => {
    apiService.send.mockRejectedValue(
      new ErrorResponse(
        {
          message:
            "Too many sign-in requests are waiting for this account. Answer them, or wait 15 minutes.",
          errorModel: {
            message:
              "Too many sign-in requests are waiting for this account. Answer them, or wait 15 minutes.",
          },
        },
        429,
      ),
    );
    const response = await run();
    expect(response.message).toBe(
      "Too many sign-in requests are waiting for this account. Answer them, or wait 15 minutes.",
    );
  });

  it("stops at Ctrl-C, overwrites the private key, and signs nothing in", async () => {
    server({ RequestApproved: null });
    const running = command.run(DANA.email, NULL, { device: true });
    await jest.advanceTimersByTimeAsync(12_000);
    expect(stderr[0]).toBe(`Fingerprint phrase: ${DANA.phrase}\n`);
    process.emit("SIGINT");
    await jest.advanceTimersByTimeAsync(0);
    const response = await running;
    expect(response).toMatchObject({ success: false, message: STOPPED });
    expect(loginStrategyService.logIn).not.toHaveBeenCalled();
    expect(generatedPrivateKey.every((b) => b === 0)).toBe(true);
    expect(process.listenerCount("SIGINT")).toBe(0);
  });

  it("takes two-step login's code as with a password", async () => {
    server({ RequestApproved: true, Key: vectors.approval.key });
    // A script gives its authenticator's code up front.
    const response = await run({ device: true, method: "0", code: "123456" });
    expect(response.success).toBe(true);
    const credentials = loginStrategyService.logIn.mock.calls[0][0] as AuthRequestLoginCredentials;
    expect(credentials.twoFactor).toMatchObject({
      provider: TwoFactorProviderType.Authenticator,
      token: "123456",
    });
  });

  it("asks for two-step login's code after the approval, as for a password", async () => {
    server({ RequestApproved: true, Key: vectors.approval.key });
    const twoStep = new AuthResult();
    twoStep.twoFactorProviders = { [TwoFactorProviderType.Authenticator]: {} } as any;
    loginStrategyService.logIn.mockResolvedValue(twoStep);
    loginStrategyService.logInTwoFactor.mockResolvedValue(success());
    twoFactorService.getSupportedProviders.mockResolvedValue([
      { type: TwoFactorProviderType.Authenticator, name: "Authenticator" } as any,
    ]);
    // Without a terminal, and without --code, there's nobody to ask.
    expect((await run()).message).toBe("Code is required.");
    expect(loginStrategyService.logInTwoFactor).not.toHaveBeenCalled();
  });

  it("sends an email code with the request and its access code, never a password", async () => {
    server({ RequestApproved: true, Key: vectors.approval.key });
    const twoStep = new AuthResult();
    twoStep.twoFactorProviders = { [TwoFactorProviderType.Email]: {} } as any;
    loginStrategyService.logIn.mockResolvedValue(twoStep);
    twoFactorService.getSupportedProviders.mockResolvedValue([
      { type: TwoFactorProviderType.Email, name: "Email" } as any,
    ]);
    loginStrategyService.getEmail.mockResolvedValue(DANA.email);
    const response = await run();
    // Without a terminal it can't ask for the code that was sent.
    expect(response.message).toBe("Code is required.");
    const sent = twoFactorApiService.postTwoFactorEmail.mock.calls[0][0];
    const credentials = loginStrategyService.logIn.mock.calls[0][0] as AuthRequestLoginCredentials;
    expect(sent).toMatchObject({
      email: DANA.email,
      deviceIdentifier: "device-1",
      authRequestId: "request-1",
      authRequestAccessCode: credentials.accessCode,
    });
  });

  it("says to use single sign-on where the organization requires it, and opens nothing", async () => {
    server({ RequestApproved: true, Key: vectors.approval.key });
    const sso = new AuthResult();
    sso.ssoOrganizationIdentifier = "contoso";
    loginStrategyService.logIn.mockResolvedValue(sso);
    const response = await run();
    expect(response.message).toBe(
      "Your organization requires you to sign in with single sign-on. A device's approval doesn't stand in for it: run `bw login --sso contoso`.",
    );
  });

  it("prints the server's message when two-step login for admins refuses it", async () => {
    server({ RequestApproved: true, Key: vectors.approval.key });
    loginStrategyService.logIn.mockRejectedValue(
      new ErrorResponse(
        {
          Message:
            "Contoso requires two-step login for your role. Sign in with your master password in the web vault at https://vault.example.test to set it up.",
        },
        400,
      ),
    );
    const response = await run();
    expect(response.message).toBe(
      "Contoso requires two-step login for your role. Sign in with your master password in the web vault at https://vault.example.test to set it up.",
    );
  });

  it("needs the email in a script", async () => {
    const response = await command.run(NULL, NULL, { device: true });
    expect(response.message).toBe("Email address is required, and must be valid.");
    expect(apiService.send).not.toHaveBeenCalled();
  });
});
