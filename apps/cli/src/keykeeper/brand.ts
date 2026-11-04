// Keykeeper: the command-line tool's brand. These are upstream's values, so an
// unbranded build behaves as upstream's does; brand/apply.mjs writes this file
// from brand/brand.json ("cli") before a branded build, and reverts it after.
// See docs/cli.md in the meta repo.

export type CliBrand = {
  /** The product's name. */
  name: string;
  /** The command people type, which help text and examples show. */
  command: string;
  /** What the environment variables start with, such as `BW_SESSION`'s `BW_`. */
  envPrefix: string;
  /** The tool's own version, which `--version` prints; empty for the app's version. */
  version: string;
  /** Where to get the newest version; empty to check upstream's releases. */
  releases: string;
};

export const CLI_BRAND: CliBrand = {
  name: "Bitwarden",
  command: "bw",
  envPrefix: "BW_",
  version: "",
  releases: "",
};
