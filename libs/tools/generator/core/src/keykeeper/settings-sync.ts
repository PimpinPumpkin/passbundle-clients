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
 * Another part of the settings document that an app keeps on the device, such
 * as the web vault's breach check switch (`health`), synced on its own, as
 * the generator's settings are: a change made here that the server hasn't got
 * wins at the next sync, and otherwise the server's is taken. Its name in the
 * document is its own; the rest of the document stays as it is.
 */
export interface KeykeeperSyncedPart {
  readonly name: string;
  /** Its value here in the document's terms, and whether anyone set it on this device. */
  here$(userId: UserId): Observable<{ value: Record<string, unknown>; chosen: boolean }>;
  /**
   * Takes the document's value for it here (missing or malformed, too),
   * unless it changed here since `seen` (its text as this app last took it):
   * then it writes nothing and answers false, and this device's goes back.
   */
  take(userId: UserId, value: unknown, seen: string | undefined): Promise<boolean>;
}

/**
 * What the server has, as far as this app knows: the document, and the
 * generator's part (and each other part's) as this app took it. Kept on the
 * device across sign-outs, so a change not saved yet survives closing the
 * app, and an older copy from the server can be told apart.
 */
type Known = { settings: SyncedSettings; generator: string; parts?: Record<string, string> };
const KNOWN = new UserKeyDefinition<Known | null>(GENERATOR_DISK, "keykeeperSyncedSettings", {
  deserializer: (value) => value,
  clearOn: [],
});

/** The generator's settings here, and whether anyone chose them on this
 *  device since signing in (upstream forgets them at sign-out); and each
 *  other part's. */
type Here = {
  text: string;
  chosen: boolean;
  parts: Record<string, { text: string; chosen: boolean; value: Record<string, unknown> }>;
};

/** How a save writes the document: the generator's settings, and which other parts, from here. */
type Writes = { seen?: number; generator?: boolean; parts?: string[] };

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
    private readonly parts: KeykeeperSyncedPart[] = [],
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
    const changed$ = combineLatest([
      this.local$(userId).pipe(map((local) => generatorText(toSynced(local)))),
      ...this.parts.map((part) => part.here$(userId).pipe(map(({ value }) => settingsText(value)))),
    ]).pipe(
      map((texts) => texts.join("\u0000")),
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
    const parts: Here["parts"] = {};
    for (const part of this.parts) {
      const { value, chosen } = await firstValueFrom(part.here$(userId));
      parts[part.name] = { text: settingsText(value), chosen, value };
    }
    return { text: generatorText(toSynced(local)), chosen: local.chosen, parts };
  }

  /** The other parts changed here since this app last took or saved them. */
  private changedParts(known: Known | null, here: Here): string[] {
    return this.parts
      .map((part) => part.name)
      .filter((name) => here.parts[name].chosen && here.parts[name].text !== known?.parts?.[name]);
  }

  /**
   * Takes the document's other parts here, except those changed here.
   * Answers the parts whose value here goes back to the server: those changed
   * here, and any changed while it was taking.
   */
  private async takeParts(
    userId: UserId,
    settings: SyncedSettings,
    known: Known | null,
    changed: string[],
    live: () => void,
  ): Promise<string[]> {
    const ours = [...changed];
    for (const part of this.parts) {
      if (changed.includes(part.name)) {
        continue;
      }
      live();
      if (!(await part.take(userId, settings[part.name], known?.parts?.[part.name]))) {
        ours.push(part.name);
      }
    }
    return ours;
  }

  /**
   * Takes the server's settings, unless there's a change here it hasn't got,
   * or it has none this account can read, or an older copy than one this app
   * has seen: then it gets this app's.
   */
  private async read(userId: UserId, known: Known | null, live: () => void): Promise<Known> {
    const before = await this.here(userId);
    const changed = this.changedParts(known, before);
    if (known != null && before.chosen && before.text !== known.generator) {
      return this.send(userId, before, known.settings, live, known, { parts: changed });
    }
    const response: { data?: string | null } | null = await this.apiService.send(
      "GET",
      PATH,
      null,
      true,
      true,
    );
    const remote = response?.data == null ? null : await this.open(userId, response.data);
    const allParts = this.parts.map((part) => part.name);
    if (remote == null) {
      return this.send(userId, before, {}, live, known, {
        seen: revOf(known?.settings),
        parts: allParts,
      });
    }
    if (known != null && revOf(remote) < revOf(known.settings)) {
      // Older than a copy this app had: a server handing back an old one.
      this.logService.warning("The server's generator settings are older than these; kept these.");
      await this.apply(userId, known.settings, before, live);
      await this.takeParts(userId, known.settings, known, changed, live);
      return this.send(userId, await this.here(userId), known.settings, live, known, {
        parts: allParts,
      });
    }
    if (!(await this.apply(userId, remote, before, live))) {
      // Changed here while the server answered: this device's go back.
      const ours = await this.takeParts(userId, remote, known, changed, live);
      return this.send(userId, await this.here(userId), remote, live, known, { parts: ours });
    }
    const ours = await this.takeParts(userId, remote, known, changed, live);
    const after = await this.here(userId);
    if (ours.length > 0) {
      // Another part changed here: it goes back, with the server's generator settings.
      return this.send(userId, after, remote, live, known, {
        generator: false,
        parts: ours,
        knownGenerator: after.text,
      });
    }
    return { settings: remote, generator: after.text, parts: this.partTexts(after) };
  }

  private partTexts(here: Here): Record<string, string> {
    return Object.fromEntries(Object.entries(here.parts).map(([name, p]) => [name, p.text]));
  }

  private async save(userId: UserId, known: Known | null, live: () => void): Promise<Known | null> {
    const here = await this.here(userId);
    if (known == null) {
      return known;
    }
    const generator = here.chosen && here.text !== known.generator;
    const parts = this.changedParts(known, here);
    if (!generator && parts.length === 0) {
      return known;
    }
    return this.send(userId, here, known.settings, live, known, { generator, parts });
  }

  /**
   * Saves the generator's settings (unless `generator` is false) and the
   * other parts named over the document's, keeping the rest of it (and
   * settings other apps add to a part), numbered after `seen`.
   */
  private async send(
    userId: UserId,
    here: Here,
    base: SyncedSettings,
    live: () => void,
    known: Known | null,
    {
      seen = revOf(base),
      generator = true,
      parts = [],
      knownGenerator,
    }: Writes & { knownGenerator?: string } = {},
  ): Promise<Known> {
    const settings: SyncedSettings = {
      ...base,
      type: SETTINGS_TYPE,
      rev: nextRev(seen),
      generator: generator
        ? { ...(base.generator ?? {}), ...JSON.parse(here.text).generator }
        : base.generator,
    };
    for (const name of parts) {
      const was = base[name];
      settings[name] = {
        ...(was != null && typeof was === "object" && !Array.isArray(was) ? was : {}),
        ...here.parts[name].value,
      };
    }
    const key = await firstValueFrom(this.keyService.userKey$(userId));
    if (key == null) {
      throw new Error("locked");
    }
    const data = await this.encryptService.encryptString(settingsText(settings), key);
    live();
    await this.apiService.send("PUT", PATH, { data: data.encryptedString }, true, true);
    return {
      settings,
      generator: generator ? here.text : (knownGenerator ?? known?.generator ?? here.text),
      parts: this.partTexts(here),
    };
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
