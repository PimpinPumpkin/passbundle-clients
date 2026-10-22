// Keykeeper: keeps the generator's settings the same on each of someone's
// devices (DESIGN.md, "Generator settings"). Upstream keeps them on the device
// and forgets them at logout; here they're also on the server, encrypted with
// the account's key, so a length chosen in one app is the length everywhere,
// and signing out doesn't lose it. The server can't read them.
import {
  combineLatest,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  firstValueFrom,
  map,
  merge,
  Observable,
  of,
  Subscription,
  switchMap,
} from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { GENERATOR_DISK, StateProvider, UserKeyDefinition } from "@bitwarden/common/platform/state";
import { SyncService } from "@bitwarden/common/platform/sync";
import { toUserKeyDefinition } from "@bitwarden/common/tools/state/object-key";
import { UserId } from "@bitwarden/common/types/guid";
import { KeyService } from "@bitwarden/key-management";

import { Algorithm, BuiltIn, CoreProfileMetadata, Profile } from "../metadata";
import { PREFERENCES } from "../providers/credential-preferences";
import {
  CredentialPreference,
  PassphraseGenerationOptions,
  PasswordGeneratorSettings,
} from "../types";

import {
  fromSynced,
  LocalGenerator,
  nextRev,
  parseSettings,
  revOf,
  SETTINGS_TYPE,
  settingsText,
  SyncedGenerator,
  SyncedSettings,
  toSynced,
} from "./synced-settings";

const PATH = "/keykeeper/settings";

/** How long after a change to save it, so dragging a slider saves once. */
export const SAVE_AFTER_MS = 1000;

/** How long to wait for more syncs before reading the server's settings. */
export const READ_AFTER_MS = 250;

/** Where upstream keeps a generator's settings: as they are, on the device. */
function storage<T>(profile: unknown) {
  const core = profile as CoreProfileMetadata<T>;
  if (core.storage.format !== "plain") {
    throw new Error(`Generator settings ${core.storage.key} aren't kept as they are anymore.`);
  }
  return {
    key: toUserKeyDefinition(core.storage) as UserKeyDefinition<T>,
    initial: core.storage.initial as T,
  };
}

const PASSWORD = storage<PasswordGeneratorSettings>(BuiltIn.password.profiles[Profile.account]);
const PASSPHRASE = storage<PassphraseGenerationOptions>(
  BuiltIn.passphrase.profiles[Profile.account],
);

/**
 * What the server has, as far as this app knows: the document, and the
 * generator's part as this app took it. Kept on the device across sign-outs,
 * so a change not saved yet survives closing the app, and an older copy from
 * the server can be told apart.
 */
type Known = { settings: SyncedSettings; generator: string };
const KNOWN = new UserKeyDefinition<Known | null>(GENERATOR_DISK, "keykeeperSyncedSettings", {
  deserializer: (value) => value,
  clearOn: [],
});

/** The generator's settings here, and whether anyone chose them on this
 *  device since signing in (upstream forgets them at sign-out). */
type Here = { text: string; chosen: boolean };

const generatorText = (generator: SyncedGenerator) => settingsText({ generator });

export class KeykeeperGeneratorSettingsSync {
  constructor(
    private readonly apiService: ApiService,
    private readonly accountService: AccountService,
    private readonly authService: AuthService,
    private readonly syncService: SyncService,
    private readonly keyService: KeyService,
    private readonly encryptService: EncryptService,
    private readonly stateProvider: StateProvider,
    private readonly logService: LogService,
    private readonly saveAfterMs = SAVE_AFTER_MS,
    private readonly readAfterMs = READ_AFTER_MS,
  ) {}

  /** Follows whoever is signed in and unlocked. */
  start(): Subscription {
    return this.accountService.activeAccount$
      .pipe(
        getOptionalUserId,
        switchMap((userId) =>
          userId == null
            ? of(null)
            : this.authService
                .authStatusFor$(userId)
                .pipe(map((status) => (status === AuthenticationStatus.Unlocked ? userId : null))),
        ),
        distinctUntilChanged(),
        switchMap((userId) => (userId == null ? EMPTY : this.follow(userId))),
      )
      .subscribe();
  }

  /**
   * While someone's unlocked: read the server's settings now and after each
   * sync, and save theirs when they change here. One at a time, in order.
   * A change here the server hasn't got wins over the server's copy.
   */
  follow(userId: UserId): Observable<unknown> {
    const kept = this.stateProvider.getUser(userId, KNOWN);
    let reachable = true;
    // Work started while following, still running once it stops (the app
    // locked, or another account): it writes nothing.
    let following = true;
    const live = () => {
      if (!following) {
        throw new Stopped();
      }
    };
    // The last sync's time, now (once there's been one) and after each sync;
    // a few syncs at once (signing in does several) read once.
    const read$ = this.syncService.lastSync$(userId).pipe(
      filter((date) => date != null),
      distinctUntilChanged((a, b) => a?.getTime() === b?.getTime()),
      debounceTime(this.readAfterMs),
      map(() => "read" as const),
    );
    const changed$ = this.local$(userId).pipe(
      map((local) => generatorText(toSynced(local))),
      distinctUntilChanged(),
      debounceTime(this.saveAfterMs),
      map(() => "save" as const),
    );
    return merge(read$, changed$).pipe(
      filter(() => reachable),
      concatMap(async (step) => {
        try {
          const known = (await firstValueFrom(kept.state$)) ?? null;
          const next =
            step === "read"
              ? await this.read(userId, known, live)
              : await this.save(userId, known, live);
          if (next !== known) {
            live();
            await kept.update(() => next);
          }
        } catch (e) {
          if (e instanceof Stopped) {
            return;
          }
          // A server without PassBundle's settings, or not reachable now:
          // the settings stay on this device, as upstream keeps them.
          reachable = !isMissing(e);
          this.logService.warning(`Generator settings didn't sync: ${String(e)}`);
        }
      }),
      finalize(() => {
        following = false;
      }),
    );
  }

  /** The settings here, with upstream's defaults where none are saved. */
  private local$(userId: UserId): Observable<LocalGenerator & { chosen: boolean }> {
    return combineLatest([
      this.stateProvider.getUser(userId, PASSWORD.key).state$,
      this.stateProvider.getUser(userId, PASSPHRASE.key).state$,
      this.stateProvider.getUser(userId, PREFERENCES).state$,
    ]).pipe(
      map(([password, passphrase, preferences]) => ({
        password: { ...PASSWORD.initial, ...(password ?? {}) },
        passphrase: { ...PASSPHRASE.initial, ...(passphrase ?? {}) },
        algorithm:
          preferences?.password?.algorithm === Algorithm.passphrase
            ? Algorithm.passphrase
            : Algorithm.password,
        chosen: password != null || passphrase != null,
      })),
    );
  }

  private async here(userId: UserId): Promise<Here> {
    const local = await firstValueFrom(this.local$(userId));
    return { text: generatorText(toSynced(local)), chosen: local.chosen };
  }

  /**
   * Takes the server's settings, unless there's a change here it hasn't got,
   * or it has none this account can read, or an older copy than one this app
   * has seen: then it gets this app's.
   */
  private async read(userId: UserId, known: Known | null, live: () => void): Promise<Known> {
    const before = await this.here(userId);
    if (known != null && before.chosen && before.text !== known.generator) {
      return this.send(userId, before.text, known.settings, live);
    }
    const response: { data?: string | null } | null = await this.apiService.send(
      "GET",
      PATH,
      null,
      true,
      true,
    );
    const remote = response?.data == null ? null : await this.open(userId, response.data);
    if (remote == null) {
      return this.send(userId, before.text, {}, live, revOf(known?.settings));
    }
    if (known != null && revOf(remote) < revOf(known.settings)) {
      // Older than a copy this app had: a server handing back an old one.
      this.logService.warning("The server's generator settings are older than these; kept these.");
      await this.apply(userId, known.settings, before, live);
      return this.send(userId, (await this.here(userId)).text, known.settings, live);
    }
    if (!(await this.apply(userId, remote, before, live))) {
      // Changed here while the server answered: this device's go back.
      return this.send(userId, (await this.here(userId)).text, remote, live);
    }
    return { settings: remote, generator: (await this.here(userId)).text };
  }

  private async save(userId: UserId, known: Known | null, live: () => void): Promise<Known | null> {
    const here = await this.here(userId);
    if (known == null || !here.chosen || here.text === known.generator) {
      return known;
    }
    return this.send(userId, here.text, known.settings, live);
  }

  /**
   * Saves the generator's settings over the document's, keeping the rest of
   * it (and generator settings other apps add), numbered after `seen`.
   */
  private async send(
    userId: UserId,
    here: string,
    base: SyncedSettings,
    live: () => void,
    seen = revOf(base),
  ): Promise<Known> {
    const settings: SyncedSettings = {
      ...base,
      type: SETTINGS_TYPE,
      rev: nextRev(seen),
      generator: { ...(base.generator ?? {}), ...JSON.parse(here).generator },
    };
    const key = await firstValueFrom(this.keyService.userKey$(userId));
    if (key == null) {
      throw new Error("locked");
    }
    const data = await this.encryptService.encryptString(settingsText(settings), key);
    live();
    await this.apiService.send("PUT", PATH, { data: data.encryptedString }, true, true);
    return { settings, generator: here };
  }

  /** The server's settings, or none if this account's key can't open them. */
  private async open(userId: UserId, data: string): Promise<SyncedSettings | null> {
    const key = await firstValueFrom(this.keyService.userKey$(userId));
    if (key == null) {
      return null;
    }
    try {
      return parseSettings(await this.encryptService.decryptString(new EncString(data), key));
    } catch {
      return null;
    }
  }

  /**
   * Takes these settings here, unless something changed here since `seen`:
   * then it writes nothing and answers false, and this device's go back
   * instead. Writes only what differs, each only if it's still as it was.
   */
  private async apply(
    userId: UserId,
    remote: SyncedSettings,
    seen: Here,
    live: () => void,
  ): Promise<boolean> {
    const local = await firstValueFrom(this.local$(userId));
    if (local.chosen && generatorText(toSynced(local)) !== seen.text) {
      return false;
    }
    const next = fromSynced(remote.generator, local);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    live();
    if (!same(next.password, local.password)) {
      await this.stateProvider.getUser(userId, PASSWORD.key).update(() => next.password, {
        shouldUpdate: (current) =>
          same({ ...PASSWORD.initial, ...(current ?? {}) }, local.password),
      });
    }
    if (!same(next.passphrase, local.passphrase)) {
      await this.stateProvider.getUser(userId, PASSPHRASE.key).update(() => next.passphrase, {
        shouldUpdate: (current) =>
          same({ ...PASSPHRASE.initial, ...(current ?? {}) }, local.passphrase),
      });
    }
    if (next.algorithm !== local.algorithm) {
      await this.stateProvider
        .getUser(userId, PREFERENCES)
        .update((preferences: CredentialPreference | null) => ({
          ...(preferences as CredentialPreference),
          password: { algorithm: next.algorithm, updated: new Date() },
        }));
    }
    return true;
  }
}

/** Thrown in work that outlived the following it was for. */
class Stopped extends Error {}

/** The server doesn't have PassBundle's settings (an older or other server). */
function isMissing(e: unknown): boolean {
  const status = (e as { statusCode?: number })?.statusCode;
  return status === 404 || status === 405;
}
