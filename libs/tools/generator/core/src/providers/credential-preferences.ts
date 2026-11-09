import { GENERATOR_DISK, UserKeyDefinition } from "@bitwarden/common/platform/state";

import { AlgorithmsByType, CredentialType } from "../metadata";
import { CredentialPreference } from "../types";

/** plaintext password generation options */
export const PREFERENCES = new UserKeyDefinition<CredentialPreference>(
  GENERATOR_DISK,
  "credentialPreferences",
  {
    deserializer: (value) => {
      const result = (value as any) ?? {};

      for (const key in AlgorithmsByType) {
        const type = key as CredentialType;
        if (result[type]) {
          result[type].updated = new Date(result[type].updated);
        } else {
          // Keykeeper: a kind never chosen counts as chosen before any other.
          // The generator opens on the kind chosen last, so a time per kind,
          // taken one after another, opened it on Username whenever the clock
          // ticked between them.
          const [algorithm] = AlgorithmsByType[type];
          result[type] = { algorithm, updated: new Date(0) };
        }
      }

      return result;
    },
    clearOn: ["logout"],
  },
);
