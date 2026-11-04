// Keykeeper: the tool's data folder holds the server's address, the account's
// tokens, its API key's secret when it signed in with one, and the vault,
// encrypted (data.json). Someone else who can change the folder could point
// the tool at their own server or replace what it reads, and someone else who
// can read data.json gets the tokens and the API key. So the tool refuses a
// folder someone else owns or others can change, keeps data.json readable by
// its owner only every time it starts, and on Windows gives a folder it makes
// an access list for its owner alone. See docs/cli.md, "Sessions and
// environment variables".

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export type DataFolderSystem = {
  platform: NodeJS.Platform;
  /** The person's user id on POSIX systems. */
  uid: number | null;
  fs: Pick<typeof fs, "existsSync" | "statSync" | "chmodSync" | "mkdirSync">;
  /** Runs a Windows program and gives its output. */
  run: (file: string, args: string[]) => string;
};

const system: DataFolderSystem = {
  platform: process.platform,
  uid: typeof process.getuid === "function" ? process.getuid() : null,
  fs,
  run: (file, args) => execFileSync(file, args, { encoding: "utf8", windowsHide: true }),
};

/** What `secureDataFolder` decided: why the tool won't use the folder, or a warning to show. */
export type DataFolderCheck = { refuse?: string; warn?: string };

const DATA_FILES = ["data.json", "data.json.bak"];

/**
 * Checks the data folder before the tool reads anything in it, and tightens
 * what it can: refuses one someone else owns or others can change (POSIX),
 * sets data.json to 0600, and gives a new folder on Windows an access list
 * for its owner alone.
 */
export function secureDataFolder(dir: string, sys: DataFolderSystem = system): DataFolderCheck {
  if (sys.platform === "win32") {
    return secureWindowsFolder(dir, sys);
  }
  if (!sys.fs.existsSync(dir)) {
    // The storage makes it, owner-only (0700).
    return {};
  }
  const folder = sys.fs.statSync(dir);
  if (sys.uid != null && folder.uid !== sys.uid) {
    return {
      refuse:
        `The data folder ${dir} belongs to another user (uid ${folder.uid}), who could change ` +
        "what this tool reads. Use a folder of your own (PASSBUNDLE_APPDATA_DIR).",
    };
  }
  if ((folder.mode & 0o022) !== 0) {
    return {
      refuse:
        `Others can change the data folder ${dir}, and so what this tool reads. ` +
        `Check what's in it, then make it yours alone: chmod 700 "${dir}"`,
    };
  }
  for (const name of DATA_FILES) {
    const file = path.join(dir, name);
    if (!sys.fs.existsSync(file)) {
      continue;
    }
    if (sys.uid != null && sys.fs.statSync(file).uid !== sys.uid) {
      return {
        refuse: `${file} belongs to another user. Move it away, then sign in again.`,
      };
    }
    sys.fs.chmodSync(file, 0o600);
  }
  return {};
}

/** On Windows, a folder the tool makes gets an access list for its owner alone. */
function secureWindowsFolder(dir: string, sys: DataFolderSystem): DataFolderCheck {
  if (sys.fs.existsSync(dir)) {
    return {};
  }
  sys.fs.mkdirSync(dir, { recursive: true });
  try {
    // "DOMAIN\user","S-1-5-21-..."
    const sid = /"(S-1-[0-9-]+)"/.exec(sys.run("whoami", ["/user", "/fo", "csv", "/nh"]))?.[1];
    if (sid == null) {
      throw new Error("whoami didn't say who you are");
    }
    sys.run("icacls", [dir, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]);
    return {};
  } catch (e) {
    return {
      warn:
        `Couldn't make the data folder ${dir} yours alone (${(e as Error).message}). ` +
        "Anyone who can read it can use your session; set its permissions yourself.",
    };
  }
}
