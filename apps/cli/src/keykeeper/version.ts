// Keykeeper: the tool's own version. A branded build has one of its own
// (brand/apply.mjs writes it from the release's tag into keykeeper/brand.ts),
// which `--version` prints. The app version upstream's code sends to the
// server stays upstream's, since the server decides some answers by it.

import { CLI_BRAND } from "./brand";

/** What `--version` prints: the tool's own version, or else the app's. */
export function cliVersion(appVersion: string, brand = CLI_BRAND): string {
  return brand.version || appVersion;
}

/** What `update` says when the tool doesn't update itself. */
export function updateMessage(version: string, brand = CLI_BRAND): string {
  return (
    `${brand.name} CLI ${version}. It doesn't update itself: ` +
    `get the newest version from ${brand.releases}`
  );
}
