// Keykeeper: the lines a script needs to use a script token, shown once when
// the token is made (docs/script-access.md in the meta repo). MSP admins
// paste them into their RMM, which runs them as SYSTEM on clients' machines,
// so nothing an item's editor wrote may become code: the item is named by
// its id (a UUID, which the module accepts as well as a name), and the name
// goes only in a comment, as letters, digits, spaces, and plain punctuation.

import { powerShellLiteral } from "./install-command";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What an item's name may keep in the comment; everything else becomes a space. */
const UNSAFE_IN_COMMENT = /[^\p{L}\p{N} .,_()+-]/gu;
const MAX_COMMENT = 80;

/** An item's name as the comment shows it, or "" when nothing of it is safe to show. */
export function commentName(name: string): string {
  return name
    .replace(UNSAFE_IN_COMMENT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMMENT)
    .trim();
}

/**
 * The PowerShell lines to fetch the module and read the first granted item
 * (left out for anything that isn't an item's id).
 */
export function scriptUsage(serverUrl: string, item: { id: string; name: string }): string {
  const url = `${serverUrl.replace(/\/+$/, "")}/api/keykeeper/script/PassBundle.psm1`;
  const lines = [
    `Invoke-WebRequest ${powerShellLiteral(url)} -OutFile PassBundle.psm1`,
    "Import-Module .\\PassBundle.psm1",
  ];
  if (UUID.test(item.id)) {
    const name = commentName(item.name);
    lines.push(
      `$credential = Get-PassBundleCredential -Item ${powerShellLiteral(item.id.toLowerCase())}` +
        (name === "" ? "" : `  # ${name}`),
    );
  }
  return lines.join("\n");
}
