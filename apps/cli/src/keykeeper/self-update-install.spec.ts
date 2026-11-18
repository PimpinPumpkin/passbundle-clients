// Keykeeper: putting a new release in place of the running program
// (self-update-install.ts), on macOS, Linux, and Windows, with a stand-in for
// each one's file system, and for PowerShell's answer on Windows.

import {
  installRefusal,
  InstallSystem,
  removeLeftover,
  replaceProgram,
  windowsAclScript,
} from "./self-update-install";

type Entry = {
  kind: "file" | "dir" | "link";
  uid: number;
  gid: number;
  mode: number;
  data?: Buffer;
};

const ME = 501;
const MY_GROUP = 501;
const OLD = Buffer.from("old program");
const NEW = Buffer.from("new program");

/** A file system in memory, with the calls the installer makes. */
class Disk {
  entries = new Map<string, Entry>();
  calls: string[] = [];
  failRename: string | null = null;
  busy = new Set<string>();
  groups = "";

  constructor(entries: Record<string, Partial<Entry> & { kind: Entry["kind"] }>) {
    for (const [path, entry] of Object.entries(entries)) {
      this.entries.set(path, {
        uid: ME,
        gid: MY_GROUP,
        mode: entry.kind === "dir" ? 0o755 : 0o755,
        ...entry,
      });
    }
  }

  stats(entry: Entry) {
    return {
      uid: entry.uid,
      gid: entry.gid,
      mode: entry.mode,
      isFile: () => entry.kind === "file",
      isDirectory: () => entry.kind === "dir",
      isSymbolicLink: () => entry.kind === "link",
    };
  }

  get(path: string): Entry {
    const entry = this.entries.get(path);
    if (entry == null) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }
    return entry;
  }

  fs: InstallSystem["fs"] = {
    lstatSync: (p) => this.stats(this.get(p)),
    statSync: (p) => this.stats(this.get(p)),
    existsSync: (p) => this.entries.has(p),
    readFileSync: (p) => {
      if (p === "/etc/group") {
        return this.groups;
      }
      return this.get(p).data!.toString("utf8");
    },
    writeNewFile: (p, data, mode) => {
      this.calls.push(`write ${p} ${mode.toString(8)}`);
      if (this.entries.has(p)) {
        throw new Error("EEXIST");
      }
      this.entries.set(p, { kind: "file", uid: ME, gid: MY_GROUP, mode, data });
    },
    chmodSync: (p, mode) => {
      this.calls.push(`chmod ${p} ${mode.toString(8)}`);
      this.get(p).mode = mode;
    },
    renameSync: (from, to) => {
      this.calls.push(`rename ${from} ${to}`);
      if (this.failRename === from) {
        throw new Error("EPERM");
      }
      const entry = this.get(from);
      this.entries.delete(from);
      this.entries.set(to, entry);
    },
    unlinkSync: (p) => {
      this.calls.push(`unlink ${p}`);
      if (this.busy.has(p)) {
        throw new Error("EBUSY");
      }
      this.get(p);
      this.entries.delete(p);
    },
  };
}

function posix(
  platform: "linux" | "darwin",
  disk: Disk,
  execPath = "/home/ana/.local/bin/passbundle",
  changes: Partial<InstallSystem> = {},
) {
  const ran: { file: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const temp = { removed: 0 };
  const sys: InstallSystem = {
    platform,
    execPath,
    packed: true,
    uid: ME,
    gid: MY_GROUP,
    username: "ana",
    env: { PATH: "/usr/bin:/bin" },
    fs: disk.fs,
    run: (file, args, env) => {
      ran.push({ file, args, env });
      const data = disk.get(file).data!.toString("utf8");
      if (data === "broken") {
        throw new Error("Exec format error\nmore");
      }
      return data === "new program" ? "0.1.7\n" : "0.1.6\n";
    },
    tempFolder: () => ({ path: "/tmp/passbundle-update-x", remove: () => temp.removed++ }),
    random: () => "r4nd0m",
    ...changes,
  };
  return { sys, ran, temp };
}

describe("putting a new release in place on macOS and Linux", () => {
  const home = (extra: Record<string, Partial<Entry> & { kind: Entry["kind"] }> = {}) =>
    new Disk({
      "/home/ana/.local/bin": { kind: "dir" },
      "/home/ana/.local/bin/passbundle": { kind: "file", data: OLD },
      ...extra,
    });

  it.each(["linux", "darwin"] as const)(
    "on %s, writes it beside the old one, checks it, and renames it over the old one",
    (platform) => {
      const disk = home();
      const { sys, ran, temp } = posix(platform, disk);
      expect(installRefusal(sys)).toBeNull();
      replaceProgram(NEW, "0.1.7", sys);
      const fresh = "/home/ana/.local/bin/.passbundle-update-r4nd0m";
      expect(disk.calls).toEqual([
        `write ${fresh} 700`,
        `chmod ${fresh} 755`,
        `rename ${fresh} /home/ana/.local/bin/passbundle`,
      ]);
      expect(disk.get("/home/ana/.local/bin/passbundle").data).toEqual(NEW);
      expect(disk.entries.has(fresh)).toBe(false);
      // It ran the new program, with a data folder of its own, and asked nothing.
      expect(ran).toEqual([
        {
          file: fresh,
          args: ["--version"],
          env: {
            PATH: "/usr/bin:/bin",
            BW_APPDATA_DIR: "/tmp/passbundle-update-x",
            BW_NOINTERACTION: "true",
          },
        },
      ]);
      expect(temp.removed).toBe(1);
    },
  );

  it("keeps the old program's permissions, at most 0755 and at least the owner's", () => {
    const disk = home();
    disk.get("/home/ana/.local/bin/passbundle").mode = 0o100700;
    replaceProgram(NEW, "0.1.7", posix("linux", disk).sys);
    expect(disk.get("/home/ana/.local/bin/passbundle").mode).toBe(0o700);
  });

  it("leaves the old program as it was when the new one says another version", () => {
    const disk = home();
    expect(() => replaceProgram(Buffer.from("other"), "0.1.7", posix("linux", disk).sys)).toThrow(
      'the new program says it\'s "0.1.6", not 0.1.7',
    );
    expect(disk.get("/home/ana/.local/bin/passbundle").data).toEqual(OLD);
    expect([...disk.entries.keys()]).toEqual([
      "/home/ana/.local/bin",
      "/home/ana/.local/bin/passbundle",
    ]);
  });

  it("leaves the old program as it was when the new one doesn't start", () => {
    const disk = home();
    const { sys, temp } = posix("darwin", disk);
    expect(() => replaceProgram(Buffer.from("broken"), "0.1.7", sys)).toThrow(
      "the new program didn't start (Exec format error)",
    );
    expect(disk.get("/home/ana/.local/bin/passbundle").data).toEqual(OLD);
    expect(disk.entries.size).toBe(2);
    expect(temp.removed).toBe(1);
  });

  it("never writes through a file that's already there", () => {
    const disk = home({ "/home/ana/.local/bin/.passbundle-update-r4nd0m": { kind: "link" } });
    expect(() => replaceProgram(NEW, "0.1.7", posix("linux", disk).sys)).toThrow("EEXIST");
    expect(disk.get("/home/ana/.local/bin/passbundle").data).toEqual(OLD);
  });

  it("won't as root", () => {
    const { sys } = posix("linux", home(), undefined, { uid: 0 });
    expect(installRefusal(sys)).toMatch(/^it runs as root\. Install the new release/);
  });

  it("won't from a build folder", () => {
    const { sys } = posix("linux", home(), undefined, { packed: false });
    expect(installRefusal(sys)).toContain("runs with Node.js from a build folder");
  });

  it.each([
    "/usr/local/bin/passbundle",
    "/usr/bin/passbundle",
    "/opt/homebrew/bin/passbundle",
    "/home/linuxbrew/.linuxbrew/bin/passbundle",
    "/snap/passbundle/current/passbundle",
    "/nix/store/abc-passbundle/bin/passbundle",
    "/Applications/PassBundle.app/Contents/MacOS/passbundle",
  ])("won't in a system's or package manager's place: %s", (execPath) => {
    const disk = new Disk({
      [execPath.slice(0, execPath.lastIndexOf("/"))]: { kind: "dir" },
      [execPath]: { kind: "file", data: OLD },
    });
    expect(installRefusal(posix("darwin", disk, execPath).sys)).toContain(
      "a place of the system's or a package manager's",
    );
  });

  it("won't when the folder or the program is someone else's", () => {
    let disk = home();
    disk.get("/home/ana/.local/bin").uid = 502;
    expect(installRefusal(posix("linux", disk).sys)).toBe(
      "/home/ana/.local/bin belongs to someone else. Install the new release the way you installed this one (as them, or by hand): ",
    );
    disk = home();
    disk.get("/home/ana/.local/bin/passbundle").uid = 0;
    expect(installRefusal(posix("linux", disk).sys)).toContain(
      "passbundle belongs to someone else",
    );
  });

  it("won't when anyone can change the folder or the program", () => {
    for (const path of ["/home/ana/.local/bin", "/home/ana/.local/bin/passbundle"]) {
      const disk = home();
      disk.get(path).mode = 0o777;
      expect(installRefusal(posix("linux", disk).sys)).toContain(`others can change ${path}`);
    }
  });

  it("won't when its group can change the folder, unless that's the person's own private group on Linux", () => {
    const disk = home();
    disk.get("/home/ana/.local/bin").mode = 0o775;
    disk.groups = "root:x:0:\nstaff:x:20:ana,ben\nana:x:501:\n";
    expect(installRefusal(posix("linux", disk).sys)).toBeNull();
    // macOS has no private groups: staff is everyone's.
    expect(installRefusal(posix("darwin", disk).sys)).toContain(
      "others can change /home/ana/.local/bin",
    );
    // A group named after her, with someone else in it.
    disk.groups = "ana:x:501:ben\n";
    expect(installRefusal(posix("linux", disk).sys)).toContain("others can change");
    // A shared group.
    disk.groups = "devs:x:501:\n";
    expect(installRefusal(posix("linux", disk).sys)).toContain("others can change");
    // The folder's group isn't hers.
    disk.groups = "ana:x:501:\n";
    disk.get("/home/ana/.local/bin").gid = 20;
    expect(installRefusal(posix("linux", disk).sys)).toContain("others can change");
  });

  it("won't when the program isn't a plain file", () => {
    const disk = home();
    disk.get("/home/ana/.local/bin/passbundle").kind = "link";
    expect(installRefusal(posix("linux", disk).sys)).toContain("isn't a plain file");
  });

  it("says no when it can't read who can change them", () => {
    const disk = new Disk({});
    expect(installRefusal(posix("linux", disk).sys)).toContain("couldn't check who can change");
  });
});

const PROGRAM = "C:\\Users\\Ana\\AppData\\Local\\Programs\\PassBundle\\passbundle.exe";
const FOLDER = "C:\\Users\\Ana\\AppData\\Local\\Programs\\PassBundle";
const ANA = "S-1-5-21-1-2-3-1001";

type Acl = {
  user?: string;
  elevated?: boolean;
  paths?: {
    path: string;
    owner: string;
    rules: { sid: string; rights: number; allow: boolean; propagation: number }[];
  }[];
};

const usual = (path: string) => ({
  path,
  owner: ANA,
  rules: [
    { sid: ANA, rights: 2032127, allow: true, propagation: 0 },
    { sid: "S-1-5-18", rights: 2032127, allow: true, propagation: 0 },
    { sid: "S-1-5-32-544", rights: 2032127, allow: true, propagation: 0 },
  ],
});

function windows(disk: Disk, acl: Acl = {}, execPath = PROGRAM) {
  const powershell: string[][] = [];
  const answer = { user: ANA, elevated: false, paths: [usual(FOLDER), usual(PROGRAM)], ...acl };
  const sys: InstallSystem = {
    platform: "win32",
    execPath,
    packed: true,
    uid: null,
    gid: null,
    username: "Ana",
    env: {
      Path: "C:\\Windows\\system32",
      SystemRoot: "C:\\Windows",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      ProgramData: "C:\\ProgramData",
    },
    fs: disk.fs,
    run: (file, args) => {
      if (file === "powershell.exe") {
        powershell.push(args);
        return JSON.stringify(answer);
      }
      return disk.get(file).data!.toString("utf8") === "new program" ? "0.1.7\r\n" : "0.1.6\r\n";
    },
    tempFolder: () => ({
      path: "C:\\Users\\Ana\\AppData\\Local\\Temp\\passbundle-update-x",
      remove: () => {},
    }),
    random: () => "r4nd0m",
  };
  return { sys, powershell };
}

const windowsDisk = () =>
  new Disk({
    [FOLDER]: { kind: "dir" },
    [PROGRAM]: { kind: "file", data: OLD },
  });

describe("putting a new release in place on Windows", () => {
  const fresh = `${FOLDER}\\passbundle.new-r4nd0m.exe`;

  it("renames the running program away and the new one into its place", () => {
    const disk = windowsDisk();
    const { sys, powershell } = windows(disk);
    expect(installRefusal(sys)).toBeNull();
    expect(powershell).toHaveLength(1);
    replaceProgram(NEW, "0.1.7", sys);
    expect(disk.calls).toEqual([
      `write ${fresh} 700`,
      `rename ${PROGRAM} ${PROGRAM}.old`,
      `rename ${fresh} ${PROGRAM}`,
    ]);
    expect(disk.get(PROGRAM).data).toEqual(NEW);
    expect(disk.get(`${PROGRAM}.old`).data).toEqual(OLD);
  });

  it("puts the old program back when the new one can't take its name", () => {
    const disk = windowsDisk();
    disk.failRename = fresh;
    expect(() => replaceProgram(NEW, "0.1.7", windows(disk).sys)).toThrow("EPERM");
    expect(disk.get(PROGRAM).data).toEqual(OLD);
    expect(disk.entries.has(`${PROGRAM}.old`)).toBe(false);
    expect(disk.entries.has(fresh)).toBe(false);
  });

  it("leaves the old program as it was when the new one says another version", () => {
    const disk = windowsDisk();
    expect(() => replaceProgram(Buffer.from("other"), "0.1.7", windows(disk).sys)).toThrow(
      "not 0.1.7",
    );
    expect(disk.get(PROGRAM).data).toEqual(OLD);
    expect(disk.entries.size).toBe(2);
  });

  it("deletes an earlier update's old program first, and stops while it still runs", () => {
    let disk = windowsDisk();
    disk.entries.set(`${PROGRAM}.old`, { kind: "file", uid: ME, gid: ME, mode: 0o755, data: OLD });
    replaceProgram(NEW, "0.1.7", windows(disk).sys);
    expect(disk.calls[1]).toBe(`unlink ${PROGRAM}.old`);
    expect(disk.get(PROGRAM).data).toEqual(NEW);

    disk = windowsDisk();
    disk.entries.set(`${PROGRAM}.old`, { kind: "file", uid: ME, gid: ME, mode: 0o755, data: OLD });
    disk.busy.add(`${PROGRAM}.old`);
    expect(() => replaceProgram(NEW, "0.1.7", windows(disk).sys)).toThrow(
      `an earlier copy of the tool (${PROGRAM}.old) is still running. Close it, then run update again`,
    );
    expect(disk.get(PROGRAM).data).toEqual(OLD);
    expect(disk.entries.has(fresh)).toBe(false);
  });

  it("deletes the old program at the next start, once nothing runs it", () => {
    const disk = windowsDisk();
    disk.entries.set(`${PROGRAM}.old`, { kind: "file", uid: ME, gid: ME, mode: 0o755, data: OLD });
    disk.busy.add(`${PROGRAM}.old`);
    const { sys } = windows(disk);
    removeLeftover(sys);
    expect(disk.entries.has(`${PROGRAM}.old`)).toBe(true);
    disk.busy.clear();
    removeLeftover(sys);
    expect(disk.entries.has(`${PROGRAM}.old`)).toBe(false);
    // Never on macOS or Linux, nor from a build folder.
    const other = new Disk({ "/home/ana/.local/bin/passbundle.old": { kind: "file" } });
    removeLeftover(posix("linux", other).sys);
    removeLeftover({ ...sys, fs: other.fs, packed: false });
    expect(other.calls).toEqual([]);
  });

  it("won't when it runs as an administrator", () => {
    expect(installRefusal(windows(windowsDisk(), { elevated: true }).sys)).toMatch(
      /^it runs as an administrator\./,
    );
  });

  it.each([
    "C:\\Program Files\\PassBundle\\passbundle.exe",
    "C:\\Program Files (x86)\\PassBundle\\passbundle.exe",
    "C:\\ProgramData\\PassBundle\\passbundle.exe",
    "C:\\Windows\\System32\\passbundle.exe",
    "C:\\Users\\Ana\\scoop\\apps\\passbundle\\current\\passbundle.exe",
    "C:\\ProgramData\\chocolatey\\bin\\passbundle.exe",
    "C:\\Users\\Ana\\AppData\\Local\\Microsoft\\WinGet\\Packages\\PassBundle\\passbundle.exe",
  ])("won't in Windows' or a package manager's place: %s", (execPath) => {
    const { sys, powershell } = windows(windowsDisk(), {}, execPath);
    expect(installRefusal(sys)).toContain("a place of Windows' or a package manager's");
    expect(powershell).toEqual([]);
  });

  it("won't when someone else may change the folder or the program", () => {
    for (const sid of ["S-1-5-32-545", "S-1-5-11", "S-1-1-0", "S-1-5-21-1-2-3-1002"]) {
      const folder = usual(FOLDER);
      folder.rules.push({ sid, rights: 0x2 | 0x4, allow: true, propagation: 0 });
      expect(installRefusal(windows(windowsDisk(), { paths: [folder, usual(PROGRAM)] }).sys)).toBe(
        `others (${sid}) can change ${FOLDER}. Install the new release the way you installed this one (by hand): `,
      );
      const program = usual(PROGRAM);
      program.rules.push({ sid, rights: 0x10000, allow: true, propagation: 0 });
      expect(
        installRefusal(windows(windowsDisk(), { paths: [usual(FOLDER), program] }).sys),
      ).toContain(`can change ${PROGRAM}`);
    }
  });

  it("lets others read and run it, and minds only rules that apply to the folder itself", () => {
    const folder = usual(FOLDER);
    folder.rules.push(
      // Users may read and run.
      { sid: "S-1-5-32-545", rights: 0x1200a9, allow: true, propagation: 0 },
      // A deny is no grant.
      { sid: "S-1-1-0", rights: 0x10000, allow: false, propagation: 0 },
      // Inherit-only, for what's made in it later, and CREATOR OWNER.
      { sid: "S-1-5-32-545", rights: 0x2, allow: true, propagation: 2 },
      { sid: "S-1-3-0", rights: 0x10000000, allow: true, propagation: 2 },
      // TrustedInstaller.
      {
        sid: "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464",
        rights: 2032127,
        allow: true,
        propagation: 0,
      },
    );
    expect(
      installRefusal(windows(windowsDisk(), { paths: [folder, usual(PROGRAM)] }).sys),
    ).toBeNull();
  });

  it("won't when someone else owns the folder or the program", () => {
    const program = usual(PROGRAM);
    program.owner = "S-1-5-21-1-2-3-1002";
    expect(
      installRefusal(windows(windowsDisk(), { paths: [usual(FOLDER), program] }).sys),
    ).toContain(`${PROGRAM} belongs to someone else`);
  });

  it("says no when PowerShell can't say", () => {
    const { sys } = windows(windowsDisk());
    sys.run = () => {
      throw new Error("powershell.exe not found");
    };
    expect(installRefusal(sys)).toContain("couldn't check who can change");
  });

  it("asks PowerShell by security identifier, with each path quoted", () => {
    const script = windowsAclScript(["C:\\Users\\O'Brien\\bin", "C:\\x.exe"]);
    expect(script).toContain("@('C:\\Users\\O''Brien\\bin','C:\\x.exe')");
    expect(script).toContain("GetAccessRules($true, $true, $sid)");
    expect(script).toContain("GetOwner($sid)");
    expect(script).toContain("IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)");
  });
});
