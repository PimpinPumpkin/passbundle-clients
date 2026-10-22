// The root module interface has API stability guarantees
export * from "./abstractions";
export * from "./data";
export { createRandomizer, createCredentialGeneratorService } from "./factories";
export * from "./types";
export { DefaultCredentialGeneratorService } from "./services";
// Keykeeper: generated passwords that follow the site's own password rules.
export { forSiteRules, websiteHost } from "./keykeeper/site-rules";
export { KeykeeperGeneratorSettingsSync } from "./keykeeper/settings-sync";
export {
  CredentialType,
  CredentialAlgorithm,
  PasswordAlgorithm,
  Algorithm,
  BuiltIn,
  Type,
  Profile,
  GeneratorMetadata,
  GeneratorProfile,
  AlgorithmMetadata,
  AlgorithmsByType,
} from "./metadata";
export {
  isForwarderExtensionId,
  isEmailAlgorithm,
  isUsernameAlgorithm,
  isPasswordAlgorithm,
  isSameAlgorithm,
} from "./metadata/util";

// These internal interfacess are exposed for use by other generator modules
// They are unstable and may change arbitrarily
export * as engine from "./engine";
export * as integration from "./integration";
export * as policies from "./policies";
export * as providers from "./providers";
export * as rx from "./rx";
export * as services from "./services";
export * as strategies from "./strategies";
