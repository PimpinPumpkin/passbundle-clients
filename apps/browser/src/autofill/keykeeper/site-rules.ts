// Keykeeper: site rules from a signed feed, PassBundle's or the operator's
// own (DESIGN.md, "Fill rules for everyone", "Shipping: a signed feed"). The
// person's own server mirrors the feed at /api/keykeeper/site-rules/ and says
// whose it is (`SITE_RULES_FEED` on the server): PassBundle's, checked with
// the keys built into the extension (site-rules-keys.ts, empty until the
// owner adds one); an operator's, checked with the key the server names
// (`SITE_RULES_FEED_KEY`), whose rules get site fixes' treatment; or none.
//
// The extension checks the manifest when someone unlocks and every 6 hours,
// and downloads the rules file only when its SHA-256 changed. A feed that
// fails its checks (site-rules-feed.ts) changes nothing: the copy kept stays
// until it expires, and then goes. Everyone gets the same whole file from
// their own server, and which rule filled what never leaves the device.

import { distinctUntilChanged, filter, firstValueFrom, map, of, switchMap } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import {
  KEYKEEPER_SITE_FIXES_DISK,
  StateProvider,
  UserKeyDefinition,
} from "@bitwarden/common/platform/state";
import { UserId } from "@bitwarden/common/types/guid";

import { BrowserApi } from "../../platform/browser/browser-api";

import { hostOf, schemeOfUrl } from "./fill-rules";
import { USE_SITE_FIXES } from "./site-fixes";
import { SITE_RULE_SELECTORS } from "./site-rule-fields";
import {
  checkManifest,
  hasExpired,
  MAX_MANIFEST,
  MAX_RULES_FILE,
  readRules,
  rulesForPage,
  type SiteRule,
  type SiteRules,
} from "./site-rules-feed";
import { PASSBUNDLE_SITE_RULES_KEYS } from "./site-rules-keys";
import { MAX_SIGNATURE_FILE, strictKey } from "./site-rules-signature";

/** Whose feed the server mirrors, as it says at /api/keykeeper/site-rules. */
export type FeedSource =
  { feed: "passbundle" } | { feed: "operator"; key: string } | { feed: "none" };

/** A feed's rules kept on the device, with whose feed they are and the key that checked them. */
type KeptFeed = { source: "passbundle" | "operator"; key: string | null; rules: SiteRules };

/** "Use PassBundle's site rules" in Autofill settings: on until the person turns it off. */
export const USE_PASSBUNDLE_SITE_RULES = new UserKeyDefinition<boolean>(
  KEYKEEPER_SITE_FIXES_DISK,
  "usePassBundleRules",
  { deserializer: (use) => use !== false, clearOn: [] },
);

const KEPT_FEED = new UserKeyDefinition<KeptFeed | null>(KEYKEEPER_SITE_FIXES_DISK, "siteRules", {
  deserializer: (kept) => kept ?? null,
  clearOn: ["logout"],
});

export const SITE_RULES_ALARM = "keykeeper-site-rules";
/** How often the manifest is checked while someone is unlocked. */
export const CHECK_MINUTES = 6 * 60;
/** The most the server's answer about whose feed it mirrors may be. */
const MAX_SOURCE = 1024;

export type KeykeeperSiteRulesDeps = {
  apiService: ApiService;
  accountService: AccountService;
  authService: AuthService;
  stateProvider: StateProvider;
  environmentService: EnvironmentService;
  /**
   * The keys PassBundle's feed is checked with. Always the built-in list
   * (site-rules-keys.ts) in the extension; tests pass the test vectors' key
   * here, never through a build setting.
   */
  passBundleKeys?: readonly string[];
  now?: () => number;
  subtle?: SubtleCrypto;
};

export class KeykeeperSiteRules {
  /** The feed's rules kept on the device, so turning them off can drop them. */
  static readonly KEPT = KEPT_FEED;

  private readonly passBundleKeys: readonly string[];
  private readonly now: () => number;
  private readonly refreshing = new Map<UserId, Promise<void>>();

  constructor(private readonly deps: KeykeeperSiteRulesDeps) {
    this.passBundleKeys = deps.passBundleKeys ?? PASSBUNDLE_SITE_RULES_KEYS;
    this.now = deps.now ?? Date.now;
  }

  /** Checks when someone unlocks and every 6 hours, and answers content scripts' questions. */
  init() {
    this.deps.accountService.activeAccount$
      .pipe(
        getOptionalUserId,
        switchMap((userId) =>
          userId == null
            ? of(null)
            : this.deps.authService
                .authStatusFor$(userId)
                .pipe(map((status) => (status === AuthenticationStatus.Unlocked ? userId : null))),
        ),
        distinctUntilChanged(),
        filter((userId): userId is UserId => userId != null),
      )
      .subscribe((userId) => void this.refresh(userId));
    if (chrome.alarms) {
      BrowserApi.addListener(chrome.alarms.onAlarm, (alarm: chrome.alarms.Alarm) => {
        if (alarm.name === SITE_RULES_ALARM) {
          void this.refreshActive();
        }
      });
      void chrome.alarms.create(SITE_RULES_ALARM, { periodInMinutes: CHECK_MINUTES });
    }
    BrowserApi.messageListener(
      "keykeeper.site-rules",
      (message: { command?: string }, sender: chrome.runtime.MessageSender, sendResponse) => {
        if (message?.command !== SITE_RULE_SELECTORS) {
          return false;
        }
        this.selectorsForSender(sender).then(
          (result) => sendResponse({ result }),
          () => sendResponse({ result: [] }),
        );
        return true;
      },
    );
  }

  private async activeUser(): Promise<UserId | null> {
    return firstValueFrom(this.deps.accountService.activeAccount$.pipe(getOptionalUserId));
  }

  private async unlocked(userId: UserId): Promise<boolean> {
    return (
      (await firstValueFrom(this.deps.authService.authStatusFor$(userId))) ===
      AuthenticationStatus.Unlocked
    );
  }

  async refreshActive() {
    const userId = await this.activeUser();
    if (userId != null && (await this.unlocked(userId))) {
      await this.refresh(userId);
    }
  }

  /** Whether the person uses rules from this kind of feed: PassBundle's by its own setting, an operator's as site fixes. */
  private async using(userId: UserId, source: KeptFeed["source"]): Promise<boolean> {
    const setting = source === "passbundle" ? USE_PASSBUNDLE_SITE_RULES : USE_SITE_FIXES;
    return (
      (await firstValueFrom(this.deps.stateProvider.getUser(userId, setting).state$)) !== false
    );
  }

  private kept(userId: UserId): Promise<KeptFeed | null> {
    return firstValueFrom(this.deps.stateProvider.getUser(userId, KEPT_FEED).state$);
  }

  private async keep(userId: UserId, kept: KeptFeed | null) {
    await this.deps.stateProvider.getUser(userId, KEPT_FEED).update(() => kept);
  }

  /** Checks the feed for this account, one check at a time. */
  refresh(userId: UserId): Promise<void> {
    const running = this.refreshing.get(userId);
    if (running != null) {
      return running;
    }
    const check = this.check(userId).finally(() => this.refreshing.delete(userId));
    this.refreshing.set(userId, check);
    return check;
  }

  private async check(userId: UserId): Promise<void> {
    let kept = await this.kept(userId);
    if (kept != null && hasExpired(kept.rules, this.now())) {
      await this.keep(userId, null);
      kept = null;
    }
    const source = await this.source(userId);
    if (source == null) {
      // Offline, or a server without the mirror: keep what we had.
      return;
    }
    if (source.feed === "none") {
      await this.keep(userId, null);
      return;
    }
    const key = source.feed === "operator" ? source.key : null;
    const keys = source.feed === "operator" ? [source.key] : this.passBundleKeys;
    if (keys.length === 0 || !(await this.using(userId, source.feed))) {
      // No key to check it with (PassBundle's, until the owner adds one), or
      // the person turned it off: nothing kept, nothing downloaded.
      await this.keep(userId, null);
      return;
    }
    if (kept != null && (kept.source !== source.feed || kept.key !== key)) {
      // Another feed than the copy's: its sequence and trust don't carry over.
      await this.keep(userId, null);
      kept = null;
    }
    const manifestFile = await this.download(userId, "manifest.json", MAX_MANIFEST);
    const signatureFile = await this.download(userId, "manifest.json.sig", MAX_SIGNATURE_FILE);
    if (manifestFile == null || signatureFile == null) {
      return;
    }
    const now = this.now();
    const manifest = checkManifest(
      manifestFile,
      new TextDecoder().decode(signatureFile),
      keys,
      kept?.rules.sequence ?? null,
      now,
    );
    if (!manifest.ok) {
      return;
    }
    if (kept != null && kept.rules.sha256 === manifest.value.sha256) {
      // The same rules, signed again: no download, a later expiry.
      const { sequence, issued, expires } = manifest.value;
      await this.keep(userId, { ...kept, rules: { ...kept.rules, sequence, issued, expires } });
      return;
    }
    const rulesFile = await this.download(userId, manifest.value.filename, MAX_RULES_FILE);
    if (rulesFile == null) {
      return;
    }
    const rules = await readRules(rulesFile, manifest.value, now, this.deps.subtle);
    if (rules.ok) {
      await this.keep(userId, { source: source.feed, key, rules: rules.value });
    }
  }

  /** Whose feed the server mirrors, or null when it can't say (offline, an older server). */
  private async source(userId: UserId): Promise<FeedSource | null> {
    const answer = await this.download(userId, "", MAX_SOURCE);
    if (answer == null) {
      return null;
    }
    let parsed: { feed?: unknown; key?: unknown };
    try {
      parsed = JSON.parse(new TextDecoder().decode(answer));
    } catch {
      return null;
    }
    switch (parsed?.feed) {
      case "passbundle":
        return { feed: "passbundle" };
      case "none":
        return { feed: "none" };
      case "operator":
        // A key that isn't one a signature may check with means no feed.
        return typeof parsed.key === "string" && strictKey(parsed.key) != null
          ? { feed: "operator", key: parsed.key }
          : { feed: "none" };
      default:
        return null;
    }
  }

  /**
   * One of the mirror's files (or, for "", whose feed it is), as its exact
   * bytes, from the person's own server, at most `max` bytes. Null for
   * anything but a 200, so a missing file never signs anyone out.
   */
  private async download(userId: UserId, name: string, max: number): Promise<Uint8Array | null> {
    try {
      const environment = await firstValueFrom(
        this.deps.environmentService.getEnvironment$(userId),
      );
      const path =
        name === "" ? "/keykeeper/site-rules" : `/keykeeper/site-rules/${encodeURIComponent(name)}`;
      const token = await this.deps.apiService.getActiveBearerToken(userId);
      const response = await this.deps.apiService.fetch(
        new Request(environment.getApiUrl() + path, {
          method: "GET",
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}`, Accept: "*/*" },
        }),
      );
      if (response.status !== 200) {
        return null;
      }
      return await readAtMost(response, max);
    } catch {
      return null;
    }
  }

  /**
   * The rules of the feed kept for the page at `url`: only on https pages,
   * only while the person uses that feed's rules, and none once the copy
   * expired.
   */
  async rulesFor(url: string): Promise<SiteRule[]> {
    const userId = await this.activeUser();
    const host = hostOf(url);
    if (userId == null || host === "" || schemeOfUrl(url) !== "https") {
      return [];
    }
    const kept = await this.kept(userId);
    if (kept == null || !(await this.using(userId, kept.source))) {
      return [];
    }
    if (hasExpired(kept.rules, this.now())) {
      await this.keep(userId, null);
      return [];
    }
    return rulesForPage(kept.rules, host, new URL(url).pathname, this.now());
  }

  /** Every selector of the rules for the page at `url`, for its content script to find. */
  async selectorsFor(url: string): Promise<string[]> {
    const rules = await this.rulesFor(url);
    return [...new Set(rules.flatMap((rule) => Object.values(rule.fields).flat()))];
  }

  /** For a content script: the selectors for its own frame's address, never one it names itself. */
  private async selectorsForSender(sender: chrome.runtime.MessageSender): Promise<string[]> {
    const userId = await this.activeUser();
    if (userId == null || !(await this.unlocked(userId))) {
      return [];
    }
    const url = await BrowserApi.getSenderFrameUrl(sender);
    return url ? this.selectorsFor(url) : [];
  }
}

/** A response's body, or null when it's longer than `max` bytes. */
async function readAtMost(response: Response, max: number): Promise<Uint8Array | null> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > max) {
    return null;
  }
  const reader = response.body?.getReader();
  if (reader == null) {
    const whole = new Uint8Array(await response.arrayBuffer());
    return whole.length > max ? null : whole;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
