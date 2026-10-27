// Keykeeper: see data-folder.ts.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { DataFolderSystem, secureDataFolder } from "./data-folder";

const posix = process.platform !== "win32";
const uid = posix && process.getuid ? process.getuid() : 0;

function system(overrides: Partial<DataFolderSystem> = {}): DataFolderSystem {
  return { platform: "linux", uid, fs, run: () => "", ...overrides };
}

function folder(mode: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-data-"));
  fs.chmodSync(dir, mode);
  return dir;
}

(posix ? describe : describe.skip)("the data folder on Mac and Linux", () => {
  it("takes a folder of the person's own, and makes data.json theirs alone", () => {
    const dir = folder(0o700);
    fs.writeFileSync(path.join(dir, "data.json"), "{}", { mode: 0o644 });
    fs.chmodSync(path.join(dir, "data.json"), 0o644);
    expect(secureDataFolder(dir, system())).toEqual({});
    expect(fs.statSync(path.join(dir, "data.json")).mode & 0o777).toBe(0o600);
  });

  it("leaves a folder that isn't there yet to the storage, which makes it owner-only", () => {
    expect(secureDataFolder(path.join(os.tmpdir(), "pb-data-not-there-yet"), system())).toEqual({});
  });

  it.each([0o770, 0o777, 0o722, 0o702])("refuses a folder others can change (mode %o)", (mode) => {
    const dir = folder(mode);
    expect(secureDataFolder(dir, system()).refuse).toContain("Others can change the data folder");
  });

  it("refuses a folder someone else owns", () => {
    const dir = folder(0o700);
    expect(secureDataFolder(dir, system({ uid: uid + 1 })).refuse).toContain(
      "belongs to another user",
    );
  });

  it("refuses a data file someone else owns", () => {
    const dir = folder(0o700);
    fs.writeFileSync(path.join(dir, "data.json"), "{}");
    const statSync = ((p: fs.PathLike) => {
      const real = fs.statSync(p);
      return String(p).endsWith("data.json") ? { ...real, uid: uid + 1 } : real;
    }) as typeof fs.statSync;
    expect(secureDataFolder(dir, system({ fs: { ...fs, statSync } })).refuse).toContain(
      "data.json belongs to another user",
    );
  });
});

describe("the data folder on Windows", () => {
  it("gives a folder it makes an access list for its owner alone", () => {
    const made: string[] = [];
    const calls: string[][] = [];
    const sys = system({
      platform: "win32",
      fs: { ...fs, existsSync: () => false, mkdirSync: ((p: string) => made.push(p)) as any },
      run: (file, args) => {
        calls.push([file, ...args]);
        return file === "whoami" ? '"CONTOSO\\ana","S-1-5-21-1-2-3-1001"\r\n' : "";
      },
    });
    expect(secureDataFolder("C:\\Users\\ana\\AppData\\Roaming\\PassBundle CLI", sys)).toEqual({});
    expect(made).toEqual(["C:\\Users\\ana\\AppData\\Roaming\\PassBundle CLI"]);
    expect(calls[1]).toEqual([
      "icacls",
      "C:\\Users\\ana\\AppData\\Roaming\\PassBundle CLI",
      "/inheritance:r",
      "/grant:r",
      "*S-1-5-21-1-2-3-1001:(OI)(CI)F",
    ]);
  });

  it("warns loudly when it can't", () => {
    const sys = system({
      platform: "win32",
      fs: { ...fs, existsSync: () => false, mkdirSync: ((): undefined => undefined) as any },
      run: () => {
        throw new Error("Access is denied.");
      },
    });
    expect(secureDataFolder("C:\\data", sys).warn).toContain("Couldn't make the data folder");
  });

  it("leaves a folder that's already there as it is", () => {
    const run = jest.fn();
    expect(
      secureDataFolder(
        "C:\\data",
        system({ platform: "win32", fs: { ...fs, existsSync: () => true }, run }),
      ),
    ).toEqual({});
    expect(run).not.toHaveBeenCalled();
  });
});
