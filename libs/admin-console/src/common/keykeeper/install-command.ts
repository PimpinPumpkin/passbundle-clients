// Keykeeper: the install command an admin runs on each computer, usually as
// an administrator from their RMM. The token comes from the server, and a
// hacked server must not become code running on every client machine, so
// every part is checked against what it can be and then single-quoted.
// Windows runs our PowerShell script; Linux runs our shell script; a Mac takes
// its managed settings only from a profile the MDM installs, so its command
// writes that profile (make-profile.sh), and our shell script installs the app.
// See DESIGN.md, "Installer and agent" and "Onboarding through the RMM".

/** An enrollment token: 32 random bytes, base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** An HTTPS address in plain ASCII: PowerShell also treats curly quotes as quotes. */
const SERVER_URL =
  /^https:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
/**
 * The address the Mac and Linux scripts take: the same, with a host name or
 * IPv4 address (they refuse an IPv6 one), so a command they'd refuse is never
 * shown.
 */
const UNIX_SERVER_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
/** The brand's Windows script name, such as Install-PassBundle.ps1. */
const SCRIPT = /^[A-Za-z0-9._-]+\.ps1$/;
/** The brand's Mac and Linux script name, such as install-passbundle.sh. */
const UNIX_SCRIPT = /^[A-Za-z0-9._-]+\.sh$/;
/** The profile make-profile.sh writes, such as PassBundle.mobileconfig. */
const MAC_PROFILE = /^[A-Za-z0-9._-]+\.mobileconfig$/;

/** The script that writes the Mac profile. It doesn't carry the product's name. */
export const MAC_PROFILE_SCRIPT = "make-profile.sh";

/**
 * What the command carries besides the token: the join secret, and the
 * fingerprint of the organization's public key, each 32 bytes in base64url.
 * See DESIGN.md, "Joins a hacked server can't forge".
 */
export type InstallCommandParts = { secret: string; fingerprint: string };

/**
 * What the command sets besides joining: the organization's choices for the
 * browsers. With `browserAutofillOff`, the scripts turn off Chrome's, Edge's,
 * and Firefox's own card and address autofill by policy (DESIGN.md,
 * "Addresses and cards").
 */
export type InstallCommandOptions = { browserAutofillOff?: boolean };

/** The organization's setting, as the install command's options. */
export function installOptionsFor(browserAutofill: string | undefined): InstallCommandOptions {
  return { browserAutofillOff: browserAutofill === "off" || browserAutofill === "offAndImport" };
}

/** The computers a command is for. */
export type InstallPlatform = "windows" | "macos" | "linux";

export const INSTALL_PLATFORMS: readonly InstallPlatform[] = ["windows", "macos", "linux"];

/** The install scripts' file names, which carry the product's name (brand.json). */
export type InstallScriptNames = {
  /** The Windows script, such as Install-PassBundle.ps1. */
  windows: string;
  /** The Mac and Linux script, such as install-passbundle.sh. */
  unix: string;
  /** The profile make-profile.sh writes for the MDM, such as PassBundle.mobileconfig. */
  macProfile: string;
};

/** What to run for one kind of computer. */
export type InstallSteps = {
  /**
   * The command that carries the server, the token, the join secret, and the
   * key fingerprint. On a Mac, it writes the profile to upload to the MDM.
   */
  command: string;
  /** On a Mac, the command that installs the app and its desktop agent; it carries nothing secret. */
  app?: string;
};

/**
 * The Windows command to show and copy, or null when any part isn't what it
 * should be. Callers show an error instead of the command then.
 */
export function installCommand(
  script: string,
  serverUrl: string,
  token: string,
  parts?: InstallCommandParts | null,
  options?: InstallCommandOptions,
): string | null {
  const url = serverUrl.replace(/\/+$/, "");
  if (!SCRIPT.test(script) || !SERVER_URL.test(url) || !checkedToken(token, parts)) {
    return null;
  }
  const command = [
    `.\\${script} -ServerUrl ${quote(url)} -EnrollmentToken ${quote(token)}`,
    ...(parts == null
      ? []
      : [`-JoinSecret ${quote(parts.secret)} -OrgKey ${quote(parts.fingerprint)}`]),
    ...(options?.browserAutofillOff ? ["-DisableCardAutofill -DisableAddressAutofill"] : []),
  ];
  return command.join(" ");
}

/**
 * What to run on each kind of computer, with the same server, token, join
 * secret, and key fingerprint, each checked and single-quoted for the shell
 * that runs it; or null when any part isn't what it should be (callers show
 * an error instead of the command then).
 */
export function installSteps(
  platform: InstallPlatform,
  scripts: InstallScriptNames,
  serverUrl: string,
  token: string,
  parts?: InstallCommandParts | null,
  options?: InstallCommandOptions,
): InstallSteps | null {
  if (platform === "windows") {
    const command = installCommand(scripts.windows, serverUrl, token, parts, options);
    return command == null ? null : { command };
  }
  const url = serverUrl.replace(/\/+$/, "");
  if (!UNIX_SCRIPT.test(scripts.unix) || !UNIX_SERVER_URL.test(url)) {
    return null;
  }
  if (!checkedToken(token, parts)) {
    return null;
  }
  const args = [
    `--server-url ${shellLiteral(url)}`,
    `--enrollment-token ${shellLiteral(token)}`,
    ...(parts == null
      ? []
      : [
          `--join-secret ${shellLiteral(parts.secret)}`,
          `--org-key ${shellLiteral(parts.fingerprint)}`,
        ]),
    ...(options?.browserAutofillOff ? ["--disable-card-autofill --disable-address-autofill"] : []),
  ].join(" ");
  if (platform === "linux") {
    return { command: `./${scripts.unix} ${args}` };
  }
  if (!MAC_PROFILE.test(scripts.macProfile)) {
    return null;
  }
  return {
    command: `./${MAC_PROFILE_SCRIPT} ${args} > ${scripts.macProfile}`,
    app: `./${scripts.unix}`,
  };
}

/** The token, and the join secret and fingerprint when there are any, are what they should be. */
function checkedToken(token: string, parts?: InstallCommandParts | null): boolean {
  return (
    TOKEN.test(token) &&
    (parts == null || (TOKEN.test(parts.secret) && TOKEN.test(parts.fingerprint)))
  );
}

/** A PowerShell literal string. The checks above already rule out quotes. */
function quote(value: string): string {
  return powerShellLiteral(value);
}

/**
 * Any text as a PowerShell single-quoted (literal) string, in which nothing
 * is expanded. PowerShell ends one at any of four quote characters, the
 * apostrophe and three curly ones, and reads any of them twice as one, so
 * each is doubled.
 */
export function powerShellLiteral(value: string): string {
  return `'${value.replace(/['‘’‚‛]/g, (q) => q + q)}'`;
}

/**
 * Any text as a POSIX shell single-quoted string, in which nothing is
 * expanded. Only the apostrophe ends one, and a quoted string can't hold
 * one, so each is closed, escaped, and reopened. The checks above already
 * rule out quotes.
 */
export function shellLiteral(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Shown in place of a command that didn't pass the checks. */
export const INSTALL_COMMAND_REFUSED =
  "This install command didn't look right, so it isn't shown. Reload the page, and if it happens again, contact support.";
