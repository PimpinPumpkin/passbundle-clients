import { BehaviorSubject, firstValueFrom, of } from "rxjs";

import { BrowserAutofillOrg } from "@bitwarden/common/admin-console/keykeeper/browser-autofill";

import {
  AccountOrgs,
  accountOrgs$,
  BrowserAutofillState,
  decide,
  emptyState,
  KeykeeperBrowserAutofillSwitches,
  PrivacySwitch,
  StateStore,
  SwitchState,
} from "./browser-autofill-switches";

/** A browser setting as the privacy API keeps it, with who controls it. */
class FakeSwitch implements PrivacySwitch {
  sets: boolean[] = [];
  clears = 0;
  constructor(public state: SwitchState) {}
  async get() {
    return { ...this.state };
  }
  async set(value: boolean) {
    this.sets.push(value);
    this.state = { levelOfControl: "controlled_by_this_extension", value };
  }
  async clear() {
    this.clears++;
    this.state = { levelOfControl: "controllable_by_this_extension", value: true };
  }
}

const free = (): SwitchState => ({ levelOfControl: "controllable_by_this_extension", value: true });

function memoryStore(start = emptyState()): StateStore & { state: BrowserAutofillState } {
  const store = {
    state: start,
    get: async () => JSON.parse(JSON.stringify(store.state)),
    set: async (s: BrowserAutofillState) => {
      store.state = JSON.parse(JSON.stringify(s));
    },
  };
  return store;
}

const org = (
  id: string,
  mode: BrowserAutofillOrg["keykeeperBrowserAutofill"],
  member = true,
): BrowserAutofillOrg => ({ id, name: `Org ${id}`, member, keykeeperBrowserAutofill: mode });

const work: AccountOrgs = { userId: "work", orgs: [org("acme", "off")] };
const personal: AccountOrgs = { userId: "me", orgs: [org("family", "unchanged")] };

function setUp(start?: BrowserAutofillState) {
  const cards = new FakeSwitch(free());
  const addresses = new FakeSwitch(free());
  const store = memoryStore(start);
  const accounts$ = new BehaviorSubject<AccountOrgs[]>([]);
  const switches = new KeykeeperBrowserAutofillSwitches({ cards, addresses }, store, accounts$);
  return { cards, addresses, store, accounts$, switches };
}

describe("which profiles count as work", () => {
  it("is a profile signed in to a confirmed member of an organization that turns them off", () => {
    expect(decide([work]).off).toBe(true);
    expect(decide([work]).orgs).toEqual([{ id: "acme", name: "Org acme" }]);
    expect(decide([personal, work]).off).toBe(true);
  });

  it("never a profile signed out, or signed in only outside such an organization", () => {
    expect(decide([]).off).toBe(false);
    expect(decide([personal]).off).toBe(false);
    // An invitation, or a revoked membership, doesn't make a profile work.
    expect(decide([{ userId: "x", orgs: [org("acme", "off", false)] }]).off).toBe(false);
  });

  it("offers to bring them in only to the accounts whose organization asks for it", () => {
    const offering: AccountOrgs = { userId: "ana", orgs: [org("lake", "offAndImport")] };
    expect(decide([work, offering, personal]).offerTo).toEqual(["ana"]);
    expect(decide([work]).offerTo).toEqual([]);
  });
});

describe("KeykeeperBrowserAutofillSwitches", () => {
  it("turns both switches off in a work profile, and remembers it took them", async () => {
    const { cards, addresses, store, switches } = setUp();
    const state = await switches.apply(decide([work]));
    expect(cards.sets).toEqual([false]);
    expect(addresses.sets).toEqual([false]);
    expect(state.taken).toEqual({ cards: true, addresses: true });
    expect(state.now.cards).toEqual({
      levelOfControl: "controlled_by_this_extension",
      value: false,
    });
    expect(store.state.off).toBe(true);
  });

  it("leaves a personal profile alone", async () => {
    const { cards, addresses, switches } = setUp();
    await switches.apply(decide([personal]));
    expect(cards.sets).toEqual([]);
    expect(addresses.sets).toEqual([]);
    expect(cards.clears + addresses.clears).toBe(0);
  });

  it("lets go of what it took when no organization asks any more", async () => {
    const { cards, addresses, store, switches } = setUp();
    await switches.apply(decide([work]));
    const state = await switches.apply(decide([personal]));
    expect(cards.clears).toBe(1);
    expect(addresses.clears).toBe(1);
    expect(state.taken).toEqual({ cards: false, addresses: false });
    expect(store.state.off).toBe(false);
  });

  it("never lets go of a switch the person had turned off with upstream's own setting", async () => {
    const { cards, addresses, switches } = setUp();
    // The person made it the default password manager before: off, by this extension.
    cards.state = { levelOfControl: "controlled_by_this_extension", value: false };
    addresses.state = { levelOfControl: "controlled_by_this_extension", value: false };
    const on = await switches.apply(decide([work]));
    expect(on.taken).toEqual({ cards: false, addresses: false });
    await switches.apply(decide([]));
    expect(cards.clears + addresses.clears).toBe(0);
    expect(cards.state.value).toBe(false);
  });

  it("turns a switch off again if it was turned back on while the extension held it", async () => {
    const { cards, switches } = setUp();
    await switches.apply(decide([work]));
    // Upstream's own setting turned it back on.
    cards.state = { levelOfControl: "controlled_by_this_extension", value: true };
    await switches.apply(decide([work]));
    expect(cards.sets).toEqual([false, false]);
  });

  it("takes nothing a policy or another extension controls, and says so", async () => {
    const { cards, addresses, switches } = setUp();
    cards.state = { levelOfControl: "not_controllable", value: false };
    addresses.state = { levelOfControl: "controlled_by_other_extensions", value: true };
    const state = await switches.apply(decide([work]));
    expect(cards.sets).toEqual([]);
    expect(addresses.sets).toEqual([]);
    expect(state.taken).toEqual({ cards: false, addresses: false });
    expect(state.now.cards?.levelOfControl).toBe("not_controllable");
    // And never clears what it didn't take.
    await switches.apply(decide([]));
    expect(cards.clears + addresses.clears).toBe(0);
  });

  it("does nothing where the browser has no switches (Firefox), but keeps what it learned", async () => {
    const store = memoryStore();
    const switches = new KeykeeperBrowserAutofillSwitches(null, store, of([]));
    const state = await switches.apply(decide([work]));
    expect(state.off).toBe(true);
    expect(state.now).toEqual({});
    expect(state.taken).toEqual({ cards: false, addresses: false });
  });

  it("keeps what the popup recorded", async () => {
    const start = { ...emptyState(), seen: ["acme"], offered: ["ana"] };
    const { switches, store } = setUp(start);
    await switches.apply(decide([work]));
    expect(store.state.seen).toEqual(["acme"]);
    expect(store.state.offered).toEqual(["ana"]);
  });

  it("follows the accounts as they sign in and out", async () => {
    const { cards, accounts$, switches } = setUp();
    const subscription = switches.start();
    accounts$.next([personal]);
    accounts$.next([personal, work]);
    accounts$.next([personal]);
    // Each change waits for the one before.
    await (switches as unknown as { queue: Promise<void> }).queue;
    expect(cards.sets).toEqual([false]);
    expect(cards.clears).toBe(1);
    subscription.unsubscribe();
  });
});

describe("accountOrgs$", () => {
  it("gives every signed-in account's organizations, and none without accounts", async () => {
    const orgsOf = (id: string) => of(id === "work" ? work.orgs : personal.orgs);
    expect(await firstValueFrom(accountOrgs$(of(["work", "me"]), orgsOf))).toEqual([
      work,
      personal,
    ]);
    expect(await firstValueFrom(accountOrgs$(of([]), orgsOf))).toEqual([]);
  });
});
