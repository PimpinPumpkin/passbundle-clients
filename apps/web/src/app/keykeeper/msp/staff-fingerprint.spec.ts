import { compareLine, FingerprintMaker, staffPhrase, staffPhrases } from "./staff-fingerprint";

/** Records what it was asked, and answers words made from it. */
function maker(): FingerprintMaker & { calls: [string, number[]][] } {
  const calls: [string, number[]][] = [];
  return {
    calls,
    getFingerprint: async (material, publicKey) => {
      calls.push([material, [...publicKey]]);
      return ["acid", "bagel", "cobalt", "dune", "ember"];
    },
  };
}

describe("Staff fingerprint phrases", () => {
  it("are upstream's phrase from the person's account id and the key the server gives for them, as account settings show it", async () => {
    const m = maker();
    // "AAEC" is the bytes 0, 1, 2.
    expect(await staffPhrase(m, { userId: "user-dana", publicKey: "AAEC" })).toBe(
      "acid-bagel-cobalt-dune-ember",
    );
    expect(m.calls).toEqual([["user-dana", [0, 1, 2]]]);
  });

  it("are left out when the server gives no key, or one that can't be read", async () => {
    const m = maker();
    expect(await staffPhrase(m, { userId: "user-1" })).toBeNull();
    expect(await staffPhrase(m, { userId: "user-1", publicKey: null })).toBeNull();
    expect(await staffPhrase(m, { userId: "user-1", publicKey: "" })).toBeNull();
    expect(m.calls).toEqual([]);
    const failing: FingerprintMaker = {
      getFingerprint: () => Promise.reject(new Error("bad key")),
    };
    expect(await staffPhrase(failing, { userId: "user-1", publicKey: "AAEC" })).toBeNull();
  });

  it("are listed by account id for everyone who has one", async () => {
    const phrases = await staffPhrases(maker(), [
      { userId: "user-dana", publicKey: "AAEC" },
      { userId: "user-new", publicKey: null },
    ]);
    expect([...phrases.entries()]).toEqual([["user-dana", "acid-bagel-cobalt-dune-ember"]]);
  });

  it("say what to compare and how, in one line", () => {
    expect(compareLine({ name: "Dana", email: "dana@northwind.test" }, false)).toBe(
      "Ask Dana to read the phrase in Settings, My account. If it's different, remove them from your staff: the key this server gave out for them isn't theirs.",
    );
    expect(compareLine({ name: null, email: "dana@northwind.test" }, false)).toBe(
      "Ask dana@northwind.test to read the phrase in Settings, My account. If it's different, remove them from your staff: the key this server gave out for them isn't theirs.",
    );
    expect(compareLine({ name: "  ", email: "dana@northwind.test" }, false)).toContain(
      "Ask dana@northwind.test",
    );
    expect(compareLine({ name: "Ana", email: "ana@northwind.test" }, true)).toBe(
      "Yours. Your Settings, My account shows the same phrase. If it's different, the key this server gives out for you isn't yours: tell your MSP's other admins.",
    );
  });
});
