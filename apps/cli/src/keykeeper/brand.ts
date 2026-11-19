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
  /** The GitHub repository whose `cli-v*` releases `update` installs, as `owner/name`. */
  releaseRepository: string;
  /**
   * The CLI release key's public halves, as 64 hex digits each (Ed25519):
   * `update` installs only a release whose manifest one of them signed.
   * Empty until the key is made, and then `update` installs nothing.
   */
  releaseKeys: string[];
  /**
   * The server `script get` asks unless told another (the product's own
   * service); empty to need one named, as an unbranded build does.
   */
  server: string;
};

export const CLI_BRAND: CliBrand = {
  name: "Bitwarden",
  command: "bw",
  envPrefix: "BW_",
  version: "",
  releases: "",
  releaseRepository: "",
  releaseKeys: [],
  server: "",
};
