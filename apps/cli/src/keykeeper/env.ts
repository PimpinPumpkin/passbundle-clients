// Keykeeper: the environment variables a script sets for the command-line
// tool, under the brand's own names (PASSBUNDLE_SESSION, PASSBUNDLE_CLIENTID,
// and so on; see docs/cli.md in the meta repo). Upstream's code reads its own
// names (BW_SESSION, BITWARDENCLI_APPDATA_DIR, ...), so at startup each
// branded variable is copied to the name upstream's code reads.
//
// Upstream's names inherited from the environment are dropped first: they
// belong to the other product's tool, and a Bitwarden API key or session left
// in a shell must never be sent to, or used with, another server.

import { CLI_BRAND } from "./brand";

/** Upstream's variables, by the part after `BW_`: each is `<prefix><part>` under the brand. */
export const SCRIPT_VARIABLES = [
  "SESSION",
  "CLIENTID",
  "CLIENTSECRET",
  "RESPONSE",
  "RAW",
  "QUIET",
  "PRETTY",
  "CLEANEXIT",
  "NOINTERACTION",
] as const;

/** Upstream's data folder and debug switches, which don't start with `BW_`. */
export const UPSTREAM_SETTINGS: Readonly<Record<string, string>> = {
  APPDATA_DIR: "BITWARDENCLI_APPDATA_DIR",
  DEBUG: "BITWARDENCLI_DEBUG",
};

const UPSTREAM_PREFIXES = ["BW_", "BITWARDENCLI_"];

/**
 * Copies the brand's variables to upstream's names, after dropping any of
 * upstream's names the environment had. Does nothing for an unbranded build
 * (prefix `BW_`), which reads upstream's names as upstream does.
 */
export function applyBrandEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  prefix: string = CLI_BRAND.envPrefix,
): void {
  if (prefix === "BW_") {
    return;
  }
  for (const key of Object.keys(env)) {
    if (UPSTREAM_PREFIXES.some((p) => key.startsWith(p))) {
      delete env[key];
    }
  }
  for (const part of SCRIPT_VARIABLES) {
    const value = env[prefix + part];
    if (value != null) {
      env["BW_" + part] = value;
    }
  }
  for (const [part, upstream] of Object.entries(UPSTREAM_SETTINGS)) {
    const value = env[prefix + part];
    if (value != null) {
      env[upstream] = value;
    }
  }
}
