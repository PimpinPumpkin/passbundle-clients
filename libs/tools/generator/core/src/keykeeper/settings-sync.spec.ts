import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom, of, Subscription } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { GENERATOR_DISK, UserKeyDefinition } from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import { awaitAsync, FakeStateProvider, mockAccountServiceWith } from "../../../../../common/spec";
import { PREFERENCES } from "../providers/credential-preferences";
import { PassphraseGenerationOptions, PasswordGeneratorSettings } from "../types";

import { KeykeeperGeneratorSettingsSync } from "./settings-sync";

const userId = "user" as UserId;
const PASSWORD = new UserKeyDefinition<PasswordGeneratorSettings>(
  GENERATOR_DISK,
  "passwordGeneratorSettings",
  { deserializer: (v) => v, clearOn: [] },
);
const PASSPHRASE = new UserKeyDefinition<PassphraseGenerationOptions>(
  GENERATOR_DISK,
  "passphraseGeneratorSettings",
  { deserializer: (v) => v, clearOn: [] },
);

/** A stand-in for encryption: readable, but only with "the" key. */
const key = new SymmetricCryptoKey(new Uint8Array(64)) as UserKey;
const encryptService = mock<EncryptService>();
encryptService.encryptString.mockImplementation(
  async (plain) =>
    new EncString(`2.AAAA|${Buffer.from(plain).toString("base64")}|AAAA`) as EncString,
);
encryptService.decryptString.mockImplementation(async (enc) => {
  const [, data, mac] = enc.encryptedString!.slice(2).split("|");
  if (mac !== "AAAA") {
    throw new Error("wrong key");
  }
  return Buffer.from(data, "base64").toString();
});
const sealed = (settings: object, type: string | null = "passbundle.settings") =>
  `2.AAAA|${Buffer.from(JSON.stringify(type == null ? settings : { type, ...settings })).toString("base64")}|AAAA`;
const opened = (data: string) => JSON.parse(Buffer.from(data.split("|")[1], "base64").toString());

describe("KeykeeperGeneratorSettingsSync", () => {
  let server: { data: string | null; status?: number };
  let puts: object[];
  let lastSync: BehaviorSubject<Date | null>;
  let state: FakeStateProvider;
  let api: ApiService;
  let running: Subscription | undefined;

  function sync(saveAfterMs = 5) {
    const accountService = mockAccountServiceWith(userId);
    state ??= new FakeStateProvider(accountService);
    const syncService = mock<SyncService>({ lastSync$: () => lastSync });
    const authService = mock<AuthService>({
      authStatusFor$: () => of(AuthenticationStatus.Unlocked),
    });
    const keyService = mock<KeyService>({ userKey$: () => of(key) });
    return new KeykeeperGeneratorSettingsSync(
      api,
      accountService,
      authService,
      syncService,
      keyService,
      encryptService,
      state,
      mock<LogService>(),
      saveAfterMs,
    );
  }

  const password = () => firstValueFrom(state.getUser(userId, PASSWORD).state$);
  const passphrase = () => firstValueFrom(state.getUser(userId, PASSPHRASE).state$);
  const setPassword = (settings: PasswordGeneratorSettings) =>
    state.getUser(userId, PASSWORD).update(() => settings);

  beforeEach(() => {
    state = undefined!;
    lastSync = new BehaviorSubject<Date | null>(new Date(1000));
    server = { data: null };
    puts = [];
    api = mock<ApiService>();
    (api.send as jest.Mock).mockImplementation(async (method: string, path: string, body: any) => {
      expect(path).toBe("/keykeeper/settings");
      if (server.status != null) {
        throw { statusCode: server.status };
      }
      if (method === "PUT") {
        puts.push(opened(body.data));
        server.data = body.data;
      }
      return { object: "keykeeperSettings", data: server.data };
    });
  });

  afterEach(() => running?.unsubscribe());

  it("gives a server without settings this device's, PassBundle's defaults until someone changes them", async () => {
    running = sync().start();
    await awaitAsync(30);

    expect(puts).toEqual([
      {
        type: "passbundle.settings",
        rev: expect.any(Number),
        generator: {
          kind: "password",
          length: 20,
          uppercase: true,
          lowercase: true,
          digits: true,
          symbols: true,
          avoidAmbiguous: true,
          minDigits: 1,
          minSymbols: 1,
          words: 6,
          separator: "-",
          capitalize: false,
          includeNumber: false,
        },
      },
    ]);
  });

  it("takes the server's settings on unlock, and doesn't send them back", async () => {
    server.data = sealed({
      generator: { kind: "passphrase", length: 32, symbols: false, words: 8, separator: "_" },
      somethingElse: { kept: true },
    });
    running = sync().start();
    await awaitAsync(30);

    expect(await password()).toMatchObject({ length: 32, special: false, number: true });
    expect(await passphrase()).toMatchObject({ numWords: 8, wordSeparator: "_" });
    const preferences = await firstValueFrom(state.getUser(userId, PREFERENCES).state$);
    expect(preferences.password.algorithm).toBe("passphrase");
    expect(puts).toEqual([]);
  });

  it("saves a change made here, keeping settings it doesn't know", async () => {
    server.data = sealed({ generator: { length: 24 }, somethingElse: { kept: true } });
    running = sync().start();
    await awaitAsync(30);

    await setPassword({ ...(await password()), length: 40 });
    await awaitAsync(30);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ generator: { length: 40 }, somethingElse: { kept: true } });
  });

  it("keeps a change here that isn't saved yet when a sync comes first", async () => {
    server.data = sealed({ generator: { length: 24 } });
    running = sync(10_000).start();
    await awaitAsync(30);

    await setPassword({ ...(await password()), length: 40 });
    // Another device's old settings are still on the server.
    lastSync.next(new Date(2000));
    await awaitAsync(30);

    expect((await password()).length).toBe(40);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ generator: { length: 40 } });
  });

  it("takes another device's change at the next sync", async () => {
    server.data = sealed({ rev: 100, generator: { length: 24 } });
    running = sync().start();
    await awaitAsync(30);

    server.data = sealed({ rev: 200, generator: { length: 64 } });
    lastSync.next(new Date(2000));
    await awaitAsync(30);

    expect((await password()).length).toBe(64);
    expect(puts).toEqual([]);
  });

  it("replaces settings this account's key can't open (its key changed)", async () => {
    server.data = "2.AAAA|bm9wZQ==|BBBB";
    running = sync().start();
    await awaitAsync(30);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ generator: { length: 20 } });
  });

  it("holds what it takes to what upstream's generator allows", async () => {
    server.data = sealed({
      generator: { length: 9999, minDigits: -3, words: 1, separator: "::", digits: "yes" },
    });
    running = sync().start();
    await awaitAsync(30);

    expect(await password()).toMatchObject({ length: 128, minNumber: 0, number: true });
    expect(await passphrase()).toMatchObject({ numWords: 3, wordSeparator: ":" });
  });

  it("keeps settings on the device with a server that doesn't have them", async () => {
    server.status = 404;
    running = sync().start();
    await awaitAsync(30);
    const calls = (api.send as jest.Mock).mock.calls.length;

    await setPassword({ ...(await password()), length: 40 });
    lastSync.next(new Date(2000));
    await awaitAsync(30);

    expect((api.send as jest.Mock).mock.calls.length).toBe(calls);
    expect((await password()).length).toBe(40);
  });
  it("refuses an older copy than one it has seen, and saves its own again", async () => {
    server.data = sealed({ rev: 200, generator: { length: 24 } });
    running = sync().start();
    await awaitAsync(30);

    // A server hands back an older genuine copy: 8 characters, no symbols.
    server.data = sealed({ rev: 100, generator: { length: 8, symbols: false } });
    lastSync.next(new Date(2000));
    await awaitAsync(30);

    expect(await password()).toMatchObject({ length: 24, special: true });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ generator: { length: 24, symbols: true } });
    expect((puts[0] as { rev: number }).rev).toBeGreaterThan(200);
  });

  it("doesn't take something else encrypted with the account's key for its settings", async () => {
    server.data = sealed({ generator: { length: 8 } }, null);
    running = sync().start();
    await awaitAsync(30);

    expect((await password())?.length ?? 20).toBe(20);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ type: "passbundle.settings", generator: { length: 20 } });
  });

  it("saves a change made just before the app closed when it next unlocks", async () => {
    server.data = sealed({ rev: 100, generator: { length: 24 } });
    running = sync(10_000).start();
    await awaitAsync(30);
    await setPassword({ ...(await password()), length: 40 });
    // Closed before the change was saved.
    running.unsubscribe();

    running = sync().start();
    await awaitAsync(30);

    expect((await password()).length).toBe(40);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ generator: { length: 40 } });
  });

  it("takes the server's after signing out and in, not this device's defaults", async () => {
    server.data = sealed({ rev: 100, generator: { length: 24 } });
    running = sync().start();
    await awaitAsync(30);
    running.unsubscribe();
    // Signing out: upstream forgets the generator's settings here.
    await state.getUser(userId, PASSWORD).update(() => null!);
    await state.getUser(userId, PASSPHRASE).update(() => null!);

    running = sync().start();
    await awaitAsync(30);

    expect((await password()).length).toBe(24);
    expect(puts).toEqual([]);
  });

  it("keeps generator settings another app added when it saves a change", async () => {
    server.data = sealed({ rev: 100, generator: { length: 24, pin: { digits: 6 } } });
    running = sync().start();
    await awaitAsync(30);

    await setPassword({ ...(await password()), length: 40 });
    await awaitAsync(30);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ generator: { length: 40, pin: { digits: 6 } } });
  });
});
