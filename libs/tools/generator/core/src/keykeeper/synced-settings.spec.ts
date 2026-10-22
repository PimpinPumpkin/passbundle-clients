import { Algorithm } from "../metadata";

import {
  fromSynced,
  LocalGenerator,
  nextRev,
  parseSettings,
  revOf,
  settingsText,
  toSynced,
} from "./synced-settings";

const local: LocalGenerator = {
  algorithm: Algorithm.password,
  password: {
    length: 20,
    ambiguous: false,
    uppercase: true,
    minUppercase: 1,
    lowercase: true,
    minLowercase: 1,
    number: true,
    minNumber: 1,
    special: true,
    minSpecial: 1,
  },
  passphrase: { numWords: 6, wordSeparator: "-", capitalize: false, includeNumber: false },
};

describe("generator settings in the apps' shared terms", () => {
  it("names upstream's settings the way the PassBundle apps do", () => {
    expect(toSynced({ ...local, algorithm: Algorithm.passphrase })).toEqual({
      kind: "passphrase",
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
    });
  });

  it("comes back the same", () => {
    const changed: LocalGenerator = {
      algorithm: Algorithm.passphrase,
      password: { ...local.password, length: 33, special: false, ambiguous: true, minNumber: 4 },
      passphrase: { numWords: 9, wordSeparator: ".", capitalize: true, includeNumber: true },
    };
    expect(fromSynced(toSynced(changed), local)).toEqual(changed);
  });

  it("keeps what's here for anything missing or not what it should be", () => {
    const taken = fromSynced(
      { length: "long" as unknown as number, symbols: false, kind: "pin" as "password" },
      local,
    );
    expect(taken.password.length).toBe(20);
    expect(taken.password.special).toBe(false);
    expect(taken.algorithm).toBe(Algorithm.password);
    expect(fromSynced(undefined, local)).toEqual(local);
  });

  it("holds numbers to upstream's limits and takes one separator character", () => {
    const taken = fromSynced(
      { length: 2, minSymbols: 12, words: 50, separator: "🙂🙂", minDigits: 2.5 },
      local,
    );
    expect(taken.password.length).toBe(5);
    expect(taken.password.minSpecial).toBe(9);
    expect(taken.password.minNumber).toBe(1);
    expect(taken.passphrase.numWords).toBe(20);
    expect(taken.passphrase.wordSeparator).toBe("🙂");
  });

  it("writes the document the same way whatever order it was built in", () => {
    expect(settingsText({ generator: { length: 1, kind: "password" }, b: 1, a: [2] })).toBe(
      '{"a":[2],"b":1,"generator":{"kind":"password","length":1}}',
    );
  });

  it("reads only PassBundle's settings document as one", () => {
    expect(parseSettings('{"type":"passbundle.settings","generator":{"length":30}}')).toEqual({
      type: "passbundle.settings",
      generator: { length: 30 },
    });
    // Something else encrypted with the account's key doesn't pass for it.
    expect(parseSettings('{"generator":{"length":30}}')).toBeNull();
    expect(parseSettings('"Work email"')).toBeNull();
    expect(parseSettings("[1]")).toBeNull();
    expect(parseSettings("null")).toBeNull();
    expect(parseSettings("not json")).toBeNull();
  });

  it("numbers each save after every one seen, and after the time", () => {
    expect(revOf({ rev: 41 })).toBe(41);
    expect(revOf({ rev: -1 })).toBe(0);
    expect(revOf({ rev: "9" as unknown as number })).toBe(0);
    expect(revOf(null)).toBe(0);
    expect(nextRev(41, 7)).toBe(42);
    expect(nextRev(41, 1000)).toBe(1000);
  });
});
