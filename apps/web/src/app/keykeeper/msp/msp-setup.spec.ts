import { readMspList, rememberSetUpMsp, SET_UP_MSP_FOR_MS, takeSetUpMsp } from "./msp-setup";

// Keykeeper: an MSP signing up by itself from the website (DESIGN.md, "MSP
// console", "Getting there"): what this browser remembers, for how long, and
// how the console reads whether the server lets people set one up.

/** A Storage kept in memory. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

/** A Storage that refuses everything, as a private window or blocked site data can. */
const refusing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
} as unknown as Storage;

const NOW = 1_795_000_000_000;

describe("Remembering that someone came to set up an MSP", () => {
  it("sends them there once, right after", () => {
    const storage = memoryStorage();
    rememberSetUpMsp(storage, NOW);

    expect(takeSetUpMsp(storage, NOW + 5 * 60_000)).toBe(true);
    // Once: the next time the vault opens, it's the vault.
    expect(takeSetUpMsp(storage, NOW + 6 * 60_000)).toBe(false);
  });

  it("keeps it for a day, which covers the emailed sign-up link's 30 minutes, and no longer", () => {
    const storage = memoryStorage();
    rememberSetUpMsp(storage, NOW);
    expect(takeSetUpMsp(storage, NOW + SET_UP_MSP_FOR_MS)).toBe(true);

    rememberSetUpMsp(storage, NOW);
    expect(takeSetUpMsp(storage, NOW + SET_UP_MSP_FOR_MS + 1)).toBe(false);
    // Forgotten anyway, so it never comes back.
    expect(storage.length).toBe(0);
  });

  it("takes a clock that moved back a little, and nothing from the future", () => {
    const storage = memoryStorage();
    rememberSetUpMsp(storage, NOW);
    expect(takeSetUpMsp(storage, NOW - 30_000)).toBe(true);

    rememberSetUpMsp(storage, NOW);
    expect(takeSetUpMsp(storage, NOW - 2 * 60 * 60_000)).toBe(false);
  });

  it("isn't sent anywhere by nothing, or by something that isn't a time", () => {
    const storage = memoryStorage();
    expect(takeSetUpMsp(storage, NOW)).toBe(false);

    storage.setItem("keykeeperSetUpMsp", "/msp");
    expect(takeSetUpMsp(storage, NOW)).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("does without storage that's missing or refuses", () => {
    expect(() => rememberSetUpMsp(null, NOW)).not.toThrow();
    expect(() => rememberSetUpMsp(refusing, NOW)).not.toThrow();
    expect(takeSetUpMsp(null, NOW)).toBe(false);
    expect(takeSetUpMsp(refusing, NOW)).toBe(false);
  });
});

describe("Whether the server lets people set up an MSP", () => {
  const msps = [{ id: "msp-id", name: "Northwind IT", role: "admin" as const }];

  it("reads the server's answer", () => {
    expect(readMspList({ data: msps, setUpAllowed: true })).toEqual({ msps, setUpAllowed: true });
    expect(readMspList({ data: [], setUpAllowed: false })).toEqual({
      msps: [],
      setUpAllowed: false,
    });
  });

  it("leaves it to Create MSP when the server doesn't say", () => {
    expect(readMspList({ data: msps })).toEqual({ msps, setUpAllowed: true });
    expect(readMspList(null)).toEqual({ msps: [], setUpAllowed: true });
  });
});
