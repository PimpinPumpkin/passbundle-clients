import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom, of, Subscription } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { awaitAsync, FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeykeeperGeneratorSettingsSync } from "@bitwarden/generator-core";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import { FillRule } from "./fill-rules";
import { KeykeeperSiteNeverFill, MAX_LIST_TEXT, SITE_NEVER_FILL } from "./site-never-fill";

const userId = "user" as UserId;

/** A stand-in for encryption: readable, but only with "the" key (its mac is the key's name). */
const key = new SymmetricCryptoKey(new Uint8Array(64)) as UserKey;
const otherKey = new SymmetricCryptoKey(new Uint8Array(64).fill(1)) as UserKey;
const macOf = (k: unknown) => (k === key ? "AAAA" : "BBBB");
const encryptService = mock<EncryptService>();
encryptService.encryptString.mockImplementation(
  async (plain, k) =>
    new EncString(`2.AAAA|${Buffer.from(plain).toString("base64")}|${macOf(k)}`) as EncString,
);
encryptService.decryptString.mockImplementation(async (enc, k) => {
  const [, data, mac] = enc.encryptedString!.slice(2).split("|");
  if (mac !== macOf(k)) {
    throw new Error("wrong key");
  }
  return Buffer.from(data, "base64").toString();
});
const opened = (data: string) => JSON.parse(Buffer.from(data.split("|")[1], "base64").toString());

const never = (id: string, host = "bank.example.test"): FillRule => ({
  v: 1,
  host,
  scheme: "https",
  field: { id },
  fill: { from: "never" },
});

describe("Keykeeper site-wide never-fill", () => {
  let userKey: BehaviorSubject<UserKey | null>;
  let state: FakeStateProvider;

  function list(provider = state) {
    const accountService = mockAccountServiceWith(userId);
    const keyService = mock<KeyService>({ userKey$: () => userKey });
    return new KeykeeperSiteNeverFill(provider, keyService, encryptService, accountService);
  }

  beforeEach(() => {
    userKey = new BehaviorSubject<UserKey | null>(key);
    state = new FakeStateProvider(mockAccountServiceWith(userId));
  });

  const stored = () => firstValueFrom(state.getUser(userId, SITE_NEVER_FILL).state$);

  it("keeps the list encrypted with the account's key, on the device too", async () => {
    const neverFill = list();

    expect(await neverFill.add(never("custno"))).toBe(true);

    expect(await neverFill.list(userId)).toEqual([never("custno")]);
    const data = (await stored())!;
    expect(data).toMatch(/^2\./);
    expect(data).not.toContain("bank.example.test");
    expect(opened(data)).toEqual([never("custno")]);
  });

  it("gives the rules for a page: the same scheme, host, and port only", async () => {
    const neverFill = list();
    await neverFill.add(never("custno"));
    await neverFill.add(never("pin", "bank.example.test:8443"));

    expect(await neverFill.rulesFor("https://bank.example.test/login")).toEqual([never("custno")]);
    expect(await neverFill.rulesFor("https://bank.example.test:8443/")).toEqual([
      never("pin", "bank.example.test:8443"),
    ]);
    expect(await neverFill.rulesFor("http://bank.example.test/login")).toEqual([]);
    expect(await neverFill.rulesFor("https://other.example.test/")).toEqual([]);
  });

  it("keeps one rule per field and site, and removes one", async () => {
    const neverFill = list();
    await neverFill.add(never("custno"));
    await neverFill.add(never("custno"));
    await neverFill.add(never("custno", "other.example.test"));

    expect(await neverFill.list(userId)).toHaveLength(2);

    await neverFill.remove(never("custno"));
    expect(await neverFill.list(userId)).toEqual([never("custno", "other.example.test")]);
  });

  it("keeps both of two rules added at once", async () => {
    const neverFill = list();

    await Promise.all([neverFill.add(never("a")), neverFill.add(never("b"))]);

    expect((await neverFill.list(userId)).map((r) => r.field.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps a change another of the extension's pages made meanwhile", async () => {
    // The popup and the background each have one, over the same storage.
    const popup = list();
    const background = list();
    await background.add(never("a"));
    await popup.add(never("b"));
    await background.add(never("c"));

    expect((await popup.list(userId)).map((r) => r.field.id)).toEqual(["a", "b", "c"]);
  });

  it("takes only never-fill rules for a site", async () => {
    const neverFill = list();

    expect(await neverFill.add({ ...never("a"), fill: { from: "username" } })).toBe(false);
    expect(await neverFill.add({ ...never("a"), host: "" })).toBe(false);
    expect(await neverFill.list(userId)).toEqual([]);
  });

  it("says no once the list is full, and keeps what it has", async () => {
    const neverFill = list();
    let added = 0;
    while (await neverFill.add(never(`field-${added}`))) {
      added++;
    }

    expect(added).toBeGreaterThan(30);
    expect(JSON.stringify(await neverFill.list(userId)).length).toBeLessThanOrEqual(MAX_LIST_TEXT);
    expect(await neverFill.list(userId)).toHaveLength(added);
  });

  it("neither reads nor writes while the account is locked", async () => {
    const neverFill = list();
    await neverFill.add(never("custno"));
    userKey.next(null);

    expect(await neverFill.rulesFor("https://bank.example.test/")).toEqual([]);
    expect(await neverFill.add(never("pin"))).toBe(false);
    userKey.next(key);
    expect(await neverFill.list(userId)).toEqual([never("custno")]);
  });

  it("leaves a list another key encrypted alone, and fills as if there were none", async () => {
    userKey.next(otherKey);
    await list().add(never("custno"));
    userKey.next(key);
    const neverFill = list();

    expect(await neverFill.list(userId)).toEqual([]);
    expect(await neverFill.add(never("pin"))).toBe(false);
  });

  describe("following the account to its other browsers", () => {
    let server: { data: string | null };
    let puts: Record<string, unknown>[];
    let lastSync: BehaviorSubject<Date | null>;
    let running: Subscription[];

    beforeEach(() => {
      server = { data: null };
      puts = [];
      lastSync = new BehaviorSubject<Date | null>(new Date(1000));
      running = [];
    });

    afterEach(() => running.forEach((s) => s.unsubscribe()));

    /** A browser of the account's: its own storage, its own settings sync, the same server. */
    function browser() {
      const provider = new FakeStateProvider(mockAccountServiceWith(userId));
      const api = mock<ApiService>();
      (api.send as jest.Mock).mockImplementation(async (method: string, _path, body: any) => {
        if (method === "PUT") {
          puts.push(opened(body.data));
          server.data = body.data;
        }
        return { object: "keykeeperSettings", data: server.data };
      });
      const neverFill = list(provider);
      const sync = new KeykeeperGeneratorSettingsSync(
        api,
        mockAccountServiceWith(userId),
        mock<AuthService>({ authStatusFor$: () => of(AuthenticationStatus.Unlocked) }),
        mock<SyncService>({ lastSync$: () => lastSync }),
        mock<KeyService>({ userKey$: () => of(key) }),
        encryptService,
        provider,
        mock<LogService>(),
        5,
        1,
        [neverFill.syncedPart()],
      );
      running.push(sync.start());
      return neverFill;
    }

    it("sends a rule added in one, encrypted on its own inside the settings, and the other takes it", async () => {
      const first = browser();
      await awaitAsync(30);
      await first.add(never("custno"));
      await awaitAsync(30);

      const document = puts.at(-1)!;
      const part = document.fill as { neverFill: string };
      expect(part.neverFill).toMatch(/^2\./);
      expect(JSON.stringify(document)).not.toContain("bank.example.test");
      expect(opened(part.neverFill)).toEqual([never("custno")]);
      // The rest of the document stays as it was: the generator's settings.
      expect(document.generator).toBeDefined();

      const second = browser();
      await awaitAsync(30);
      expect(await second.list(userId)).toEqual([never("custno")]);

      // Removed there, it's gone here at the next sync.
      await second.remove(never("custno"));
      await awaitAsync(30);
      lastSync.next(new Date(2000));
      await awaitAsync(30);
      expect(await first.list(userId)).toEqual([]);
    });
  });
});
