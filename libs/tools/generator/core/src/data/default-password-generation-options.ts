import { PasswordGenerationOptions, PasswordGeneratorSettings } from "../types";

import { DefaultPasswordBoundaries } from "./default-password-boundaries";

/** The default options for password generation. Keykeeper: PassBundle's, as
 *  in metadata/password/random-password.ts (upstream: 14, no symbols). */
export const DefaultPasswordGenerationOptions: Partial<PasswordGenerationOptions> &
  PasswordGeneratorSettings = Object.freeze({
  length: 20,
  minLength: DefaultPasswordBoundaries.length.min,
  ambiguous: false,
  uppercase: true,
  minUppercase: 1,
  lowercase: true,
  minLowercase: 1,
  number: true,
  minNumber: 1,
  special: true,
  minSpecial: 1,
});
