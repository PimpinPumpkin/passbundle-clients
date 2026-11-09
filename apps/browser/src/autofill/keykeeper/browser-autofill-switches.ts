// Keykeeper: the browser's own card and address autofill, as the person's
// organizations set it (DESIGN.md, "Addresses and cards", "IT control of the
// browsers' own autofill", in the meta repo).
//
// In a work profile, one where the extension is signed in to an account
// that's a confirmed member of an organization whose setting is off, the
// extension turns off Chrome's and Edge's `privacy.services` switches for
// cards and addresses. An extension's setting can't be changed in the
// browser's settings while the extension is on, and a force-installed one
// can't be turned off, so it holds there. A profile signed out, or signed in
// only to accounts outside such an organization, is personal and never
// touched.
//
// When no organization asks any more, the extension lets go of the switches
// it took itself, never one the person had set with upstream's own "Make
// PassBundle your default password manager". Firefox's privacy API has no such
// switches, so there only the install scripts' policies do it.

import {
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  of,
  Subscription,
  switchMap,
} from "rxjs";

import {
  BrowserAutofillOrg,
  orgsTurningOffBrowserAutofill,
} from "@bitwarden/common/admin-console/keykeeper/browser-autofill";

/** What the browser says about one of its settings (chrome.types.ChromeSettingGetResult). */
export type SwitchState = {
  levelOfControl:
    | "not_controllable"
    | "controlled_by_other_extensions"
    | "controllable_by_this_extension"
    | "controlled_by_this_extension";
  value: boolean;
};

/** One of the browser's settings, as the privacy API gives it. */
export type PrivacySwitch = {
  get(): Promise<SwitchState>;
  set(value: boolean): Promise<void>;
  clear(): Promise<void>;
};

export type PrivacySwitches = { cards: PrivacySwitch; addresses: PrivacySwitch };

export type SwitchName = keyof PrivacySwitches;
const SWITCHES: SwitchName[] = ["cards", "addresses"];

/** What the popup reads to say what happened in this profile, and what it keeps. */
export type BrowserAutofillState = {
  /** The switches the extension took itself, so it lets go only of those. */
  taken: Record<SwitchName, boolean>;
  /** Whether an organization of an account signed in here turns them off. */
  off: boolean;
  /** Those organizations, by name, for the popup's note. */
  orgs: { id: string; name: string }[];
  /** The accounts here whose organizations offer to bring saved cards and addresses in. */
  offerTo: string[];
  /** What each switch is now, and who controls it. */
  now: Partial<Record<SwitchName, SwitchState>>;
  /** Organizations whose note the popup showed in this profile. */
  seen: string[];
  /** Accounts that saw the offer, or said Not now, in this profile. */
  offered: string[];
};

export const STATE_KEY = "keykeeperBrowserAutofill";

export function emptyState(): BrowserAutofillState {
  return {
    taken: { cards: false, addresses: false },
    off: false,
    orgs: [],
    offerTo: [],
    now: {},
    seen: [],
    offered: [],
  };
}

/** Where the state lives: the profile's own extension storage. */
export type StateStore = {
  get(): Promise<BrowserAutofillState>;
  set(state: BrowserAutofillState): Promise<void>;
};

/** One signed-in account in this profile, and its organizations. */
export type AccountOrgs = { userId: string; orgs: BrowserAutofillOrg[] };

/** What the accounts signed in here ask of this profile. */
export function decide(accounts: AccountOrgs[]): {
  off: boolean;
  orgs: { id: string; name: string }[];
  offerTo: string[];
} {
  const orgs = new Map<string, string>();
  const offerTo: string[] = [];
  for (const account of accounts) {
    const asking = orgsTurningOffBrowserAutofill(account.orgs);
    for (const org of asking) {
      orgs.set(org.id, org.name);
    }
    if (asking.some((o) => o.keykeeperBrowserAutofill === "offAndImport")) {
      offerTo.push(account.userId);
    }
  }
  return {
    off: orgs.size > 0,
    orgs: [...orgs].map(([id, name]) => ({ id, name })),
    offerTo,
  };
}

/**
 * Turns one switch off, or lets go of it. Answers whether the extension now
 * holds it because of an organization.
 */
async function applyOne(sw: PrivacySwitch, off: boolean, taken: boolean): Promise<boolean> {
  const state = await sw.get();
  if (off) {
    if (state.levelOfControl === "controlled_by_this_extension" && state.value === false) {
      // Already off by this extension: ours from before, or the person's own
      // choice with upstream's setting, which stays theirs.
      return taken;
    }
    if (
      state.levelOfControl === "controllable_by_this_extension" ||
      state.levelOfControl === "controlled_by_this_extension"
    ) {
      await sw.set(false);
      return true;
    }
    // A policy, or another extension, controls it: nothing to take.
    return false;
  }
  if (taken && state.levelOfControl === "controlled_by_this_extension") {
    await sw.clear();
  }
  return false;
}

export class KeykeeperBrowserAutofillSwitches {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly switches: PrivacySwitches | null,
    private readonly store: StateStore,
    private readonly accounts$: Observable<AccountOrgs[]>,
  ) {}

  start(): Subscription {
    return this.accounts$
      .pipe(
        map(decide),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      )
      .subscribe((wanted) => {
        // One change at a time, in order.
        this.queue = this.queue
          .then(async () => {
            await this.apply(wanted);
          })
          .catch(() => {});
      });
  }

  async apply(wanted: ReturnType<typeof decide>): Promise<BrowserAutofillState> {
    const state = await this.store.get();
    const next: BrowserAutofillState = {
      ...state,
      off: wanted.off,
      orgs: wanted.orgs,
      offerTo: wanted.offerTo,
      taken: { ...state.taken },
      now: {},
    };
    if (this.switches != null) {
      for (const name of SWITCHES) {
        const sw = this.switches[name];
        try {
          next.taken[name] = await applyOne(sw, wanted.off, state.taken[name]);
          next.now[name] = await sw.get();
        } catch {
          // The browser refused (an older one without the switch): leave it.
          next.taken[name] = state.taken[name];
        }
      }
    }
    await this.store.set(next);
    return next;
  }
}

/** The organizations of every account signed in to this extension, as they change. */
export function accountOrgs$(
  userIds$: Observable<string[]>,
  orgsOf: (userId: string) => Observable<BrowserAutofillOrg[]>,
): Observable<AccountOrgs[]> {
  return userIds$.pipe(
    switchMap((ids) =>
      ids.length === 0
        ? of([])
        : combineLatest(
            ids.map((userId) => orgsOf(userId).pipe(map((orgs) => ({ userId, orgs })))),
          ),
    ),
  );
}

/** Chrome's and Edge's switches, or null where the browser has none (Firefox, Safari). */
export function chromePrivacySwitches(): PrivacySwitches | null {
  const services = (globalThis as { chrome?: typeof chrome }).chrome?.privacy?.services;
  // Firefox's privacy API has no card or address switches, and without the
  // privacy permission there's no privacy API at all.
  if (services?.autofillCreditCardEnabled == null || services?.autofillAddressEnabled == null) {
    return null;
  }
  const wrap = (setting: chrome.types.ChromeSetting<boolean>): PrivacySwitch => ({
    get: () =>
      new Promise((resolve) =>
        setting.get({}, (details) => resolve(details as unknown as SwitchState)),
      ),
    set: (value) => new Promise((resolve) => setting.set({ value }, () => resolve())),
    clear: () => new Promise((resolve) => setting.clear({}, () => resolve())),
  });
  return {
    cards: wrap(services.autofillCreditCardEnabled),
    addresses: wrap(services.autofillAddressEnabled),
  };
}

/** The state in the profile's own extension storage. */
export function localStateStore(): StateStore {
  return {
    get: async () => {
      const found = (await chrome.storage.local.get(STATE_KEY))?.[STATE_KEY];
      return { ...emptyState(), ...(found ?? {}) };
    },
    set: async (state) => {
      await chrome.storage.local.set({ [STATE_KEY]: state });
    },
  };
}
