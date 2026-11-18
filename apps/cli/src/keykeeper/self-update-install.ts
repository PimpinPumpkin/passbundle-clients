// Keykeeper: putting a new release of the tool in place of the running one,
// for `passbundle update` (self-update.ts; DESIGN.md, "Updating itself",
// "Putting it in place" and "Where it won't", in the meta repo). Only where
// the program and its folder are the person's alone, so nobody else on the
// computer can plant or swap a program the person then runs. Elsewhere (root,
// an administrator, the system's or a package manager's places, a folder
// others can change) it says how to update instead, and changes nothing.
//
// macOS and Linux: the new program goes to a new file in the program's own
// folder, is checked, and is renamed over the old one in one step. Windows:
// a running program can't be replaced or deleted, but it can be renamed, so
// the running one becomes `<name>.old` and the new one takes its name; the
// next start deletes the `.old` (removeLeftover).

import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { CLI_BRAND } from "./brand";

type Stats = Pick<fs.Stats, "uid" | "gid" | "mode" | "isFile" | "isSymbolicLink" | "isDirectory">;

export type InstallSystem = {
  platform: NodeJS.Platform;
  /** The running program, as the OS gives it. */
  execPath: string;
  /** Whether it's a packed release program, rather than Node.js running a build folder. */
  packed: boolean;
  /** The person's user and group ids (POSIX). */
  uid: number | null;
  gid: number | null;
  username: string;
  env: NodeJS.ProcessEnv;
  fs: {
    lstatSync: (p: string) => Stats;
    statSync: (p: string) => Stats;
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, encoding: "utf8") => string;
    /** Creates a new file (never one that's there, never through a link) and writes it whole. */
    writeNewFile: (p: string, data: Buffer, mode: number) => void;
    chmodSync: (p: string, mode: number) => void;
    renameSync: (from: string, to: string) => void;
    unlinkSync: (p: string) => void;
  };
  /** Runs a program and gives its output; throws if it fails or takes longer than 30 seconds. */
  run: (file: string, args: string[], env?: NodeJS.ProcessEnv) => string;
  /** A new empty folder of the tool's own (0700), and removing it. */
  tempFolder: () => { path: string; remove: () => void };
  random: () => string;
};

const system: InstallSystem = {
  platform: process.platform,
  execPath: process.execPath,
  packed: !!(process as unknown as { pkg?: unknown }).pkg,
  uid: typeof process.getuid === "function" ? process.getuid() : null,
  gid: typeof process.getgid === "function" ? process.getgid() : null,
  username: safeUsername(),
  env: process.env,
  fs: {
    lstatSync: (p) => fs.lstatSync(p),
    statSync: (p) => fs.statSync(p),
    existsSync: (p) => fs.existsSync(p),
    readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
    writeNewFile: (p, data, mode) => {
      const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0);
      const fd = fs.openSync(p, flags, mode);
      try {
        let written = 0;
        while (written < data.length) {
          written += fs.writeSync(fd, data, written, data.length - written);
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    },
    chmodSync: (p, mode) => fs.chmodSync(p, mode),
    renameSync: (from, to) => fs.renameSync(from, to),
    unlinkSync: (p) => fs.unlinkSync(p),
  },
  run: (file, args, env) =>
    execFileSync(file, args, {
      encoding: "utf8",
      env,
      timeout: 30_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  tempFolder: () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "passbundle-update-"));
    return { path: dir, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
  },
  random: () => randomBytes(8).toString("hex"),
};

function safeUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
}

/** The system's and package managers' places on macOS and Linux. */
const POSIX_SYSTEM_PLACES = [
  "/usr/",
  "/opt/",
  "/bin/",
  "/sbin/",
  "/lib/",
  "/lib64/",
  "/etc/",
  "/snap/",
  "/nix/",
  "/var/",
  "/private/var/",
  "/Library/",
  "/System/",
  "/Applications/",
  "/home/linuxbrew/",
];

/** Package managers' folders on Windows, anywhere in the path. */
const WINDOWS_PACKAGE_PLACES = [
  "\\scoop\\apps\\",
  "\\scoop\\shims\\",
  "\\chocolatey\\",
  "\\winget\\packages\\",
  "\\winget\\links\\",
];

const SYSTEM_SID = "S-1-5-18";
const ADMINISTRATORS_SID = "S-1-5-32-544";
const TRUSTED_INSTALLER_SID = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
const CREATOR_OWNER_SID = "S-1-3-0";
/**
 * Rights that let someone change a file or folder: write or append data
 * (or add files and folders), delete what's in it, delete it, change its
 * permissions, take it over, and the generic all and write.
 */
const CHANGE_RIGHTS = 0x2 | 0x4 | 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000;
const INHERIT_ONLY = 0x2;

const installedLater = (where: string) =>
  `install the new release the way you installed this one (${where}): ${CLI_BRAND.releases}`;
const installed = (where: string) => installedLater(where).replace(/^i/, "I");

/**
 * Why this copy can't replace itself here, or null when it can. Anything
 * this can't read counts as a no.
 */
export function installRefusal(sys: InstallSystem = system): string | null {
  if (!sys.packed) {
    return "it runs with Node.js from a build folder, not as a release's program. Build it again, or install a release.";
  }
  try {
    return sys.platform === "win32" ? windowsRefusal(sys) : posixRefusal(sys);
  } catch (e) {
    return `it couldn't check who can change ${sys.execPath} (${(e as Error).message}). ${installed("by hand")}`;
  }
}

function posixRefusal(sys: InstallSystem): string | null {
  const program = sys.execPath;
  const dir = path.dirname(program);
  if (sys.uid === 0) {
    return `it runs as root. ${installed("with sudo, say")}`;
  }
  if (POSIX_SYSTEM_PLACES.some((place) => program.startsWith(place))) {
    return `it's in ${dir}, a place of the system's or a package manager's. ${installed("with sudo or the package manager")}`;
  }
  const link = sys.fs.lstatSync(program);
  if (link.isSymbolicLink() || !link.isFile()) {
    return `${program} isn't a plain file. ${installed("by hand")}`;
  }
  for (const [what, stats] of [
    [dir, sys.fs.statSync(dir)],
    [program, link],
  ] as const) {
    if (sys.uid != null && stats.uid !== sys.uid) {
      return `${what} belongs to someone else. ${installed("as them, or by hand")}`;
    }
    if (
      (stats.mode & 0o002) !== 0 ||
      ((stats.mode & 0o020) !== 0 && !privateGroup(sys, stats.gid))
    ) {
      return `others can change ${what}. Make it yours alone (chmod go-w "${what}") and run update again, or ${installedLater("by hand")}`;
    }
  }
  return null;
}

/** On Linux, the person's own group: named after them, with nobody else in it. */
function privateGroup(sys: InstallSystem, gid: number): boolean {
  if (sys.platform !== "linux" || sys.gid == null || gid !== sys.gid || sys.username === "") {
    return false;
  }
  let groups: string;
  try {
    groups = sys.fs.readFileSync("/etc/group", "utf8");
  } catch {
    return false;
  }
  for (const line of groups.split("\n")) {
    const [name, , id, members = ""] = line.split(":");
    if (Number(id) === gid && name !== undefined) {
      const others = members
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m !== "" && m !== sys.username);
      return name === sys.username && others.length === 0;
    }
  }
  return false;
}

type WindowsAcl = {
  user: string;
  elevated: boolean;
  paths: {
    path: string;
    owner: string;
    rules: { sid: string; rights: number; allow: boolean; propagation: number }[];
  }[];
};

/**
 * Windows' own PowerShell, by its full path. Started by its bare name, it's
 * looked for in the current folder first, where anyone could have left a
 * powershell.exe for an update to run.
 */
export function windowsPowerShell(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot ?? env.windir ?? "";
  const windows = /^[A-Za-z]:\\/.test(root) ? root : "C:\\Windows";
  return path.win32.join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Reads who the person is, whether they're elevated, and the program's and its folder's owners and rules, by SID. */
export function windowsAclScript(paths: string[]): string {
  const quoted = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
  return [
    "$ErrorActionPreference = 'Stop'",
    "$me = [Security.Principal.WindowsIdentity]::GetCurrent()",
    "$elevated = (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    "$sid = [Security.Principal.SecurityIdentifier]",
    `$paths = @(${quoted}) | ForEach-Object {`,
    "  $acl = Get-Acl -LiteralPath $_",
    "  @{ path = $_; owner = $acl.GetOwner($sid).Value; rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object {",
    "    @{ sid = $_.IdentityReference.Value; rights = [int]$_.FileSystemRights; allow = ($_.AccessControlType -eq 'Allow'); propagation = [int]$_.PropagationFlags }",
    "  }) }",
    "}",
    "@{ user = $me.User.Value; elevated = $elevated; paths = @($paths) } | ConvertTo-Json -Depth 5 -Compress",
  ].join("\n");
}

function windowsRefusal(sys: InstallSystem): string | null {
  const program = sys.execPath;
  const dir = path.win32.dirname(program);
  const lower = program.toLowerCase();
  const systemPlaces = [
    sys.env.ProgramFiles,
    sys.env["ProgramFiles(x86)"],
    sys.env.ProgramW6432,
    sys.env.ProgramData,
    sys.env.SystemRoot,
    sys.env.windir,
  ]
    .filter((p): p is string => !!p)
    .map((p) => p.toLowerCase().replace(/\\+$/, "") + "\\");
  if (
    systemPlaces.some((place) => lower.startsWith(place)) ||
    WINDOWS_PACKAGE_PLACES.some((place) => lower.includes(place))
  ) {
    return `it's in ${dir}, a place of Windows' or a package manager's. ${installed("with its installer or package manager")}`;
  }
  const script = windowsAclScript([dir, program]);
  const output = sys.run(windowsPowerShell(sys.env), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]);
  const acl = JSON.parse(output) as WindowsAcl;
  if (acl.elevated) {
    return `it runs as an administrator. ${installed("as an administrator, by hand")}`;
  }
  const owners = new Set([acl.user, SYSTEM_SID, ADMINISTRATORS_SID]);
  const changers = new Set([acl.user, SYSTEM_SID, ADMINISTRATORS_SID, TRUSTED_INSTALLER_SID]);
  for (const entry of acl.paths) {
    if (!owners.has(entry.owner)) {
      return `${entry.path} belongs to someone else. ${installed("as them, or by hand")}`;
    }
    for (const rule of entry.rules) {
      if (
        rule.allow &&
        (rule.rights & CHANGE_RIGHTS) !== 0 &&
        (rule.propagation & INHERIT_ONLY) === 0 &&
        rule.sid !== CREATOR_OWNER_SID &&
        !changers.has(rule.sid)
      ) {
        return `others (${rule.sid}) can change ${entry.path}. ${installed("by hand")}`;
      }
    }
  }
  return null;
}

/**
 * Puts `program` in place of the running one, after checking it says it's
 * `version`. Throws, leaving the old program as it was, if anything fails.
 */
export function replaceProgram(
  program: Buffer,
  version: string,
  sys: InstallSystem = system,
): void {
  const current = sys.execPath;
  const p = sys.platform === "win32" ? path.win32 : path.posix;
  const dir = p.dirname(current);
  const fresh =
    sys.platform === "win32"
      ? p.join(dir, `${p.basename(current, ".exe")}.new-${sys.random()}.exe`)
      : p.join(dir, `.${p.basename(current)}-update-${sys.random()}`);

  sys.fs.writeNewFile(fresh, program, 0o700);
  try {
    checkVersion(sys, fresh, version);
    if (sys.platform === "win32") {
      swapOnWindows(sys, current, fresh);
    } else {
      const mode = (sys.fs.statSync(current).mode & 0o755) | 0o700;
      sys.fs.chmodSync(fresh, mode);
      sys.fs.renameSync(fresh, current);
    }
  } catch (e) {
    try {
      sys.fs.unlinkSync(fresh);
    } catch {
      // Already in place, or already gone.
    }
    throw e;
  }
}

/** The new program runs and says it's the version its manifest names. */
function checkVersion(sys: InstallSystem, program: string, version: string): void {
  const data = sys.tempFolder();
  try {
    const env: NodeJS.ProcessEnv = {
      PATH: sys.env.PATH ?? sys.env.Path ?? "",
      [`${CLI_BRAND.envPrefix}APPDATA_DIR`]: data.path,
      [`${CLI_BRAND.envPrefix}NOINTERACTION`]: "true",
    };
    if (sys.platform === "win32" && sys.env.SystemRoot) {
      env.SystemRoot = sys.env.SystemRoot;
    }
    let said: string;
    try {
      said = sys.run(program, ["--version"], env).trim();
    } catch (e) {
      throw new Error(`the new program didn't start (${(e as Error).message.split("\n")[0]})`);
    }
    if (said !== version) {
      throw new Error(
        `the new program says it's ${JSON.stringify(said.slice(0, 40))}, not ${version}`,
      );
    }
  } finally {
    data.remove();
  }
}

/** The running program's name for its old self, on Windows. */
export const oldProgram = (current: string) => `${current}.old`;

function swapOnWindows(sys: InstallSystem, current: string, fresh: string): void {
  const old = oldProgram(current);
  if (sys.fs.existsSync(old)) {
    try {
      sys.fs.unlinkSync(old);
    } catch {
      throw new Error(
        `an earlier copy of the tool (${old}) is still running. Close it, then run update again`,
      );
    }
  }
  sys.fs.renameSync(current, old);
  try {
    sys.fs.renameSync(fresh, current);
  } catch (e) {
    sys.fs.renameSync(old, current);
    throw e;
  }
}

/** On Windows, the old program an update left, deleted once nothing runs it. */
export function removeLeftover(sys: InstallSystem = system): void {
  if (sys.platform !== "win32" || !sys.packed) {
    return;
  }
  const old = oldProgram(sys.execPath);
  try {
    if (sys.fs.existsSync(old)) {
      sys.fs.unlinkSync(old);
    }
  } catch {
    // Still running; the next start tries again.
  }
}
