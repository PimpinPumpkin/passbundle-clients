// Keykeeper: the install command an admin runs on each computer, usually as
// an administrator from their RMM. The token comes from the server, and a
// hacked server must not become code running on every client machine, so
// every part is checked against what it can be and then single-quoted.

/** An enrollment token: 32 random bytes, base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** An HTTPS address in plain ASCII: PowerShell also treats curly quotes as quotes. */
const SERVER_URL =
  /^https:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
/** The brand's script name, such as Install-PassBundle.ps1. */
const SCRIPT = /^[A-Za-z0-9._-]+\.ps1$/;

/**
 * What the command carries besides the token: the join secret, and the
 * fingerprint of the organization's public key, each 32 bytes in base64url.
 * See DESIGN.md, "Joins a hacked server can't forge".
 */
export type InstallCommandParts = { secret: string; fingerprint: string };

/**
 * The command to show and copy, or null when any part isn't what it should
 * be. Callers show an error instead of the command then.
 */
export function installCommand(
  script: string,
  serverUrl: string,
  token: string,
  parts?: InstallCommandParts | null,
): string | null {
  const url = serverUrl.replace(/\/+$/, "");
  if (!SCRIPT.test(script) || !SERVER_URL.test(url) || !TOKEN.test(token)) {
    return null;
  }
  if (parts != null && (!TOKEN.test(parts.secret) || !TOKEN.test(parts.fingerprint))) {
    return null;
  }
  const command = `.\\${script} -ServerUrl ${quote(url)} -EnrollmentToken ${quote(token)}`;
  return parts == null
    ? command
    : `${command} -JoinSecret ${quote(parts.secret)} -OrgKey ${quote(parts.fingerprint)}`;
}

/** A PowerShell literal string. The checks above already rule out quotes. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Shown in place of a command that didn't pass the checks. */
export const INSTALL_COMMAND_REFUSED =
  "This install command didn't look right, so it isn't shown. Reload the page, and if it happens again, contact support.";
