/// SDK/WASM code relies on TextEncoder/TextDecoder being available globally
import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextDecoder, TextEncoder });

import { AlgorithmsByType, Type } from "../metadata";
import { CredentialPreference } from "../types";

import { PREFERENCES } from "./credential-preferences";

const SomeCredentialPreferences: CredentialPreference = Object.freeze({
  email: Object.freeze({
    algorithm: AlgorithmsByType[Type.email][0],
    updated: new Date(0),
  }),
  password: Object.freeze({
    algorithm: AlgorithmsByType[Type.password][0],
    updated: new Date(0),
  }),
  username: Object.freeze({
    algorithm: AlgorithmsByType[Type.username][0],
    updated: new Date(0),
  }),
});

describe("PREFERENCES", () => {
  describe("deserializer", () => {
    it.each([[null], [undefined]])("creates new preferences (= %p)", (value) => {
      // this case tests what happens when the type system is bypassed
      const result = PREFERENCES.deserializer(value!);

      expect(result).toMatchObject({
        email: {
          algorithm: AlgorithmsByType[Type.email][0],
        },
        password: {
          algorithm: AlgorithmsByType[Type.password][0],
        },
        username: {
          algorithm: AlgorithmsByType[Type.username][0],
        },
      });
    });

    // Keykeeper: the generator opens on the kind chosen last, so the kinds
    // nobody chose can't look chosen, however the clock ticks meanwhile.
    describe("with a clock that ticks between each kind", () => {
      const RealDate = Date;
      beforeEach(() => {
        let now = 1_000;
        global.Date = class extends RealDate {
          constructor(...args: unknown[]) {
            if (args.length === 0) {
              super(now++);
            } else {
              super(...(args as [number]));
            }
          }
        } as DateConstructor;
      });
      afterEach(() => {
        global.Date = RealDate;
      });

      it("counts none of them as chosen", () => {
        const result = PREFERENCES.deserializer(null!);

        expect(result?.password.updated.getTime()).toBe(0);
        expect(result?.username.updated.getTime()).toBe(0);
        expect(result?.email.updated.getTime()).toBe(0);
      });

      it("counts a missing kind as chosen before the others", () => {
        const input: any = structuredClone(SomeCredentialPreferences);
        input.email.updated = 100;
        input.password.updated = 200;
        delete input.username;

        const result = PREFERENCES.deserializer(input);

        expect(result?.username.updated.getTime()).toBe(0);
        expect(result?.password.updated.getTime()).toBe(200);
      });
    });

    it("fills missing password preferences", () => {
      const input: any = structuredClone(SomeCredentialPreferences);
      delete input.password;

      const result = PREFERENCES.deserializer(input);

      expect(result).toMatchObject({
        password: {
          algorithm: AlgorithmsByType[Type.password][0],
        },
      });
    });

    it("fills missing email preferences", () => {
      const input: any = structuredClone(SomeCredentialPreferences);
      delete input.email;

      const result = PREFERENCES.deserializer(input);

      expect(result).toMatchObject({
        email: {
          algorithm: AlgorithmsByType[Type.email][0],
        },
      });
    });

    it("fills missing username preferences", () => {
      const input: any = structuredClone(SomeCredentialPreferences);
      delete input.username;

      const result = PREFERENCES.deserializer(input);

      expect(result).toMatchObject({
        username: {
          algorithm: AlgorithmsByType[Type.username][0],
        },
      });
    });

    it("converts string fields to Dates", () => {
      const input: any = structuredClone(SomeCredentialPreferences);
      input.email.updated = "1970-01-01T00:00:00.100Z";
      input.password.updated = "1970-01-01T00:00:00.200Z";
      input.username.updated = "1970-01-01T00:00:00.300Z";

      const result = PREFERENCES.deserializer(input);

      expect(result?.email.updated).toEqual(new Date(100));
      expect(result?.password.updated).toEqual(new Date(200));
      expect(result?.username.updated).toEqual(new Date(300));
    });

    it("converts number fields to Dates", () => {
      const input: any = structuredClone(SomeCredentialPreferences);
      input.email.updated = 100;
      input.password.updated = 200;
      input.username.updated = 300;

      const result = PREFERENCES.deserializer(input);

      expect(result?.email.updated).toEqual(new Date(100));
      expect(result?.password.updated).toEqual(new Date(200));
      expect(result?.username.updated).toEqual(new Date(300));
    });
  });
});
