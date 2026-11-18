// Keykeeper: `passbundle update`'s checks (self-update.ts), its unpacking
// (self-update-archive.ts), and what the command does and says
// (self-update-command.ts), against a stand-in for GitHub. Never a real
// release. The manifests' checks are the meta repo's test vectors
// (docs/vectors/cli-update-v1.json; this folder's copy is checked against it
// in tier 1).

import { createHash, createPrivateKey, sign } from "crypto";
import { gzipSync } from "zlib";

import * as JSZip from "jszip";

import { MessageResponse } from "../models/response/message.response";

import { CliBrand } from "./brand";
import * as vectors from "./cli-update-v1.vectors.json";
import {
  checkManifest,
  Getter,
  platformName,
  printable,
  releaseVersion,
  SIGNED_PREFIX,
  signatureChecks,
  UpdateRefusal,
} from "./self-update";
import { MAX_PROGRAM, programFromArchive } from "./self-update-archive";
import { runSelfUpdate, SelfUpdateDeps } from "./self-update-command";

const REPO = "PimpinPumpkin/Passbundle";
const KEY = vectors.key.public;
const privateKey = (seed: string) =>
  createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(seed, "hex"),
    ]),
    format: "der",
    type: "pkcs8",
  });
const signManifest = (manifest: string, seed = vectors.key.seed) =>
  sign(null, Buffer.from(SIGNED_PREFIX + manifest, "utf8"), privateKey(seed)).toString("base64");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

describe("the CLI release manifest test vectors", () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const read = () => checkManifest(Buffer.from(c.manifest, "utf8"), c.signature, [KEY], c.expect);
    if ("file" in c && c.file != null) {
      expect(read().file).toEqual(c.file);
    } else {
      let refused: UpdateRefusal | undefined;
      try {
        read();
      } catch (e) {
        refused = e as UpdateRefusal;
      }
      expect(refused).toBeInstanceOf(UpdateRefusal);
      expect(refused!.kind).toBe((c as { refused: string }).refused);
    }
  });

  it("checks with any pinned key, and never with none", () => {
    const c = vectors.cases[0];
    const manifest = Buffer.from(c.manifest, "utf8");
    expect(signatureChecks(manifest, c.signature, [vectors.otherKey.public, KEY])).toBe(true);
    expect(signatureChecks(manifest, c.signature, [vectors.otherKey.public])).toBe(false);
    expect(signatureChecks(manifest, c.signature, [])).toBe(false);
    expect(signatureChecks(manifest, c.signature, ["not a key"])).toBe(false);
  });

  it("takes only a signature of exactly 64 bytes, in plain base64", () => {
    const c = vectors.cases[0];
    const manifest = Buffer.from(c.manifest, "utf8");
    const raw = Buffer.from(c.signature, "base64");
    expect(signatureChecks(manifest, `\n${c.signature}\n`, [KEY])).toBe(true);
    expect(signatureChecks(manifest, raw.toString("base64url"), [KEY])).toBe(false);
    expect(
      signatureChecks(manifest, Buffer.concat([raw, Buffer.from([0])]).toString("base64"), [KEY]),
    ).toBe(false);
    expect(signatureChecks(manifest, raw.subarray(0, 63).toString("base64"), [KEY])).toBe(false);
  });
});

describe("versions and platforms", () => {
  it("reads only a release's version: digits, no leading zeros", () => {
    expect(releaseVersion("0.1.5")).toEqual([0, 1, 5]);
    expect(releaseVersion("1.12.300")).toEqual([1, 12, 300]);
    for (const not of ["0.1.05", "0.1", "0.1.5-local", "0.0.0-dev", "v0.1.5", "", "0.1.5 "]) {
      expect(releaseVersion(not)).toBeNull();
    }
  });

  it("names each platform a release is built for, and no other", () => {
    expect(platformName("darwin", "arm64")).toBe("macos-arm64");
    expect(platformName("darwin", "x64")).toBe("macos-x64");
    expect(platformName("linux", "x64")).toBe("linux-x64");
    expect(platformName("linux", "arm64")).toBe("linux-arm64");
    expect(platformName("win32", "x64")).toBe("windows-x64");
    expect(platformName("win32", "arm64")).toBeNull();
    expect(platformName("freebsd", "x64")).toBeNull();
  });

  it("prints a release's notes without control characters", () => {
    expect(printable("- Faster\n\t- \u001b[31mred\u001b[0m\u0007 and \u202eevil")).toBe(
      "- Faster\n\t- [31mred[0m and evil",
    );
  });
});

/** A tar archive as GNU tar writes one (ustar headers), gzipped. */
function tarGz(entries: { name: string; data?: Buffer; type?: string; prefix?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000755\0", 100, "latin1");
    header.write("0000000\0", 108, "latin1");
    header.write("0000000\0", 116, "latin1");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "latin1");
    header.write("15000000000\0", 136, "latin1");
    header.write(entry.type ?? "0", 156, "latin1");
    header.write("ustar  \0", 257, "latin1");
    if (entry.prefix) {
      header.write(entry.prefix, 345, 155, "utf8");
    }
    header.fill(0x20, 148, 156);
    const sum = header.reduce((total, b) => total + b, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const program = Buffer.from("#!/bin/sh\necho 0.1.7\n");
const release = (name = "passbundle") => [
  { name, data: program },
  { name: "LICENSE.txt", data: Buffer.from("GPLv3") },
  { name: "README.txt", data: Buffer.from("PassBundle CLI") },
];

async function zip(
  entries: { name: string; data?: Buffer; dir?: boolean; unixPermissions?: number }[],
  platform: "DOS" | "UNIX" = "DOS",
): Promise<Buffer> {
  const archive = new JSZip();
  for (const entry of entries) {
    if (entry.dir) {
      archive.folder(entry.name);
    } else {
      archive.file(entry.name, entry.data ?? Buffer.alloc(0), {
        unixPermissions: entry.unixPermissions,
      });
    }
  }
  return await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform });
}

const refusedArchive = (read: () => unknown) => {
  try {
    read();
  } catch (e) {
    expect(e).toBeInstanceOf(UpdateRefusal);
    return (e as Error).message;
  }
  throw new Error("not refused");
};

describe("the program out of a release's archive", () => {
  it("takes the program from a .tar.gz that holds a release's three files", () => {
    expect(programFromArchive(tarGz(release()), "tar.gz", "passbundle")).toEqual(program);
  });

  it("takes the program from a .zip that holds them, as 7-Zip on Windows writes one", async () => {
    const archive = await zip(release("passbundle.exe"));
    expect(programFromArchive(archive, "zip", "passbundle.exe")).toEqual(program);
  });

  it("refuses another file, a missing one, or one twice", async () => {
    expect(
      refusedArchive(() =>
        programFromArchive(
          tarGz([...release(), { name: "extra", data: program }]),
          "tar.gz",
          "passbundle",
        ),
      ),
    ).toContain("holds LICENSE.txt, README.txt, extra, passbundle");
    expect(
      refusedArchive(() =>
        programFromArchive(tarGz(release().slice(0, 2)), "tar.gz", "passbundle"),
      ),
    ).toContain("holds");
    expect(
      refusedArchive(() =>
        programFromArchive(
          tarGz([...release(), { name: "passbundle", data: program }]),
          "tar.gz",
          "passbundle",
        ),
      ),
    ).toContain("twice");
    expect(
      refusedArchive(() =>
        programFromArchive(
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("zlib").gzipSync(Buffer.alloc(0)),
          "tar.gz",
          "passbundle",
        ),
      ),
    ).toContain("no end");
  });

  it.each([
    ["a link", { name: "passbundle", type: "2" }],
    ["a hard link", { name: "passbundle", type: "1" }],
    ["a folder", { name: "bin", type: "5" }],
    ["a path with ..", { name: "../passbundle", data: program }],
    ["a path in a folder", { name: "bin/passbundle", data: program }],
    ["an absolute path", { name: "/usr/local/bin/passbundle", data: program }],
    ["a ustar prefix", { name: "passbundle", data: program, prefix: "bin" }],
  ])("refuses a .tar.gz with %s", (_what, entry) => {
    expect(() =>
      programFromArchive(tarGz([entry, ...release().slice(1)]), "tar.gz", "passbundle"),
    ).toThrow(UpdateRefusal);
  });

  it("refuses a pax header that renames or resizes the next entry, and reads one that only sets times", () => {
    const pax = (record: string) => {
      const line = (n: number) => `${n} ${record}\n`;
      let length = Buffer.byteLength(line(0));
      length = Buffer.byteLength(line(length));
      return { name: "PaxHeader/passbundle", type: "x", data: Buffer.from(line(length)) };
    };
    expect(() =>
      programFromArchive(tarGz([pax("path=../evil"), ...release()]), "tar.gz", "passbundle"),
    ).toThrow("renames or resizes");
    expect(() =>
      programFromArchive(tarGz([pax("size=1"), ...release()]), "tar.gz", "passbundle"),
    ).toThrow("renames or resizes");
    expect(
      programFromArchive(tarGz([pax("mtime=1500000000.5"), ...release()]), "tar.gz", "passbundle"),
    ).toEqual(program);
  });

  it("refuses a .tar.gz that unpacks past 400 MB", () => {
    const big = tarGz([{ name: "passbundle", data: Buffer.alloc(MAX_PROGRAM + 4 * 1024 * 1024) }]);
    expect(refusedArchive(() => programFromArchive(big, "tar.gz", "passbundle"))).toContain(
      "more than any release",
    );
  });

  it("refuses a .zip with a folder, a link, a path with .., or another file", async () => {
    const files = release("passbundle.exe");
    for (const entries of [
      [...files, { name: "bin", dir: true }],
      [...files, { name: "extra.txt", data: program }],
      [{ name: "../passbundle.exe", data: program }, ...files.slice(1)],
      [{ name: "bin/passbundle.exe", data: program }, ...files.slice(1)],
    ]) {
      const archive = await zip(entries);
      expect(() => programFromArchive(archive, "zip", "passbundle.exe")).toThrow(UpdateRefusal);
    }
    const link = await zip(
      [
        { name: "passbundle.exe", data: Buffer.from("C:\\evil.exe"), unixPermissions: 0o120777 },
        ...files.slice(1),
      ],
      "UNIX",
    );
    expect(() => programFromArchive(link, "zip", "passbundle.exe")).toThrow("isn't a plain file");
  });

  it("refuses a .zip whose entry doesn't unpack as it says", async () => {
    const archive = await zip(release("passbundle.exe"));
    // The program's checksum, in its central directory entry.
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt32LE((archive.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
    expect(() => programFromArchive(archive, "zip", "passbundle.exe")).toThrow(UpdateRefusal);
  });
});

/** A stand-in for GitHub: its API's list of releases, and each file's address, with redirects. */
class GitHub {
  releases: Record<string, unknown>[] = [];
  files = new Map<string, { status: number; body?: Buffer; location?: string }>();
  asked: string[] = [];
  down = false;

  get: Getter = async (url) => {
    this.asked.push(url);
    if (this.down) {
      throw new Error("ECONNREFUSED");
    }
    let answer: { status: number; body?: Buffer; location?: string } | undefined;
    if (url === `https://api.github.com/repos/${REPO}/releases?per_page=100`) {
      answer = { status: 200, body: Buffer.from(JSON.stringify(this.releases)) };
    } else {
      answer = this.files.get(url) ?? { status: 404 };
    }
    const body = answer.body ?? Buffer.alloc(0);
    return {
      status: answer.status,
      location: answer.location ?? null,
      body: (async function* () {
        // In two pieces, as a network gives it.
        yield body.subarray(0, body.length >> 1);
        yield body.subarray(body.length >> 1);
      })(),
    };
  };

  /**
   * A release as cli-release.yml publishes it: the archives, the manifest,
   * and its signature, each served from release-assets.githubusercontent.com
   * after a redirect, as GitHub does.
   */
  publish(
    version: string,
    archives: Record<string, Buffer>,
    options: {
      seed?: string | null;
      manifest?: (m: Record<string, unknown>) => Record<string, unknown>;
      listed?: (asset: Record<string, unknown>) => Record<string, unknown>;
      prerelease?: boolean;
      draft?: boolean;
    } = {},
  ) {
    const tag = `cli-v${version}`;
    const files = Object.entries(archives).map(([platform, data]) => ({
      name: `passbundle-${version}-${platform}.${platform === "windows-x64" ? "zip" : "tar.gz"}`,
      platform,
      size: data.length,
      sha256: sha256(data),
    }));
    let manifest: Record<string, unknown> = {
      format: 1,
      app: "com.passbundle.cli",
      tag,
      version,
      commit: "0123456789abcdef0123456789abcdef01234567",
      notes: `What's new in ${version}`,
      files,
    };
    manifest = options.manifest?.(manifest) ?? manifest;
    const manifestText = JSON.stringify(manifest);
    const assets: Record<string, unknown>[] = [];
    const serve = (name: string, body: Buffer) => {
      const address = `https://github.com/${REPO}/releases/download/${tag}/${name}`;
      const stored = `https://release-assets.githubusercontent.com/${tag}/${name}?sig=x`;
      this.files.set(address, { status: 302, location: stored });
      this.files.set(stored, { status: 200, body });
      let asset: Record<string, unknown> = {
        name,
        size: body.length,
        browser_download_url: address,
        digest: `sha256:${sha256(body)}`,
      };
      asset = options.listed?.(asset) ?? asset;
      assets.push(asset);
    };
    for (const [platform, data] of Object.entries(archives)) {
      serve(
        `passbundle-${version}-${platform}.${platform === "windows-x64" ? "zip" : "tar.gz"}`,
        data,
      );
    }
    serve("manifest.json", Buffer.from(manifestText));
    if (options.seed !== null) {
      serve("manifest.json.sig", Buffer.from(signManifest(manifestText, options.seed)));
    }
    this.releases.unshift({
      tag_name: tag,
      draft: options.draft ?? false,
      prerelease: options.prerelease ?? false,
      assets,
    });
  }
}

const BRAND: CliBrand = {
  name: "PassBundle",
  command: "passbundle",
  envPrefix: "PASSBUNDLE_",
  version: "0.1.5",
  releases: "https://github.com/PimpinPumpkin/Passbundle/releases?q=cli-v&expanded=true",
  releaseRepository: REPO,
  releaseKeys: [KEY],
};

describe("passbundle update", () => {
  let github: GitHub;
  let replaced: { program: Buffer; version: string }[];
  let refusal: string | null;
  let deps: SelfUpdateDeps;
  const linux = tarGz(release());

  beforeEach(() => {
    github = new GitHub();
    replaced = [];
    refusal = null;
    deps = {
      brand: BRAND,
      platform: "linux-x64",
      get: github.get,
      installRefusal: () => refusal,
      replace: (program, version) => replaced.push({ program, version }),
    };
  });

  const title = (response: Awaited<ReturnType<typeof runSelfUpdate>>) =>
    (response.data as MessageResponse).title;

  it("installs the newest signed release, after checking it all", async () => {
    github.publish("0.1.6", { "linux-x64": tarGz(release()) });
    github.publish("0.1.7", { "linux-x64": linux, "macos-arm64": tarGz(release()) });
    const response = await runSelfUpdate(false, deps);
    expect(response.success).toBe(true);
    expect(title(response)).toBe("Updated the PassBundle CLI from 0.1.5 to 0.1.7.");
    expect((response.data as MessageResponse).message).toBe("What's new in 0.1.7");
    expect(replaced).toEqual([{ program, version: "0.1.7" }]);
    // GitHub's API, then only release files from GitHub's own hosts.
    expect(github.asked[0]).toBe(`https://api.github.com/repos/${REPO}/releases?per_page=100`);
    for (const url of github.asked.slice(1)) {
      expect(new URL(url).hostname).toMatch(
        /^(github\.com|release-assets\.githubusercontent\.com)$/,
      );
    }
  });

  it("with --check, only says what's available, and downloads no program", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    const response = await runSelfUpdate(true, deps);
    expect(response.success).toBe(true);
    expect(title(response)).toBe(
      "PassBundle CLI 0.1.7 is available (this is 0.1.5). Run `passbundle update` to install it.",
    );
    expect((response.data as MessageResponse).raw).toBe("0.1.7");
    expect(replaced).toEqual([]);
    expect(github.asked.some((url) => url.includes(".tar.gz"))).toBe(false);
  });

  it("says when this copy is the newest", async () => {
    github.publish("0.1.5", { "linux-x64": linux });
    github.publish("0.1.4", { "linux-x64": linux });
    const response = await runSelfUpdate(false, deps);
    expect(title(response)).toBe("PassBundle CLI 0.1.5 is the newest version.");
    expect(replaced).toEqual([]);
  });

  it("contacts nothing and changes nothing while no release key is pinned", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    for (const check of [false, true]) {
      const response = await runSelfUpdate(check, {
        ...deps,
        brand: { ...BRAND, releaseKeys: [] },
      });
      expect(response.success).toBe(false);
      expect(response.message).toBe(
        "Updates aren't available yet: releases of the PassBundle CLI aren't signed yet, and the tool " +
          `installs only signed ones. Get the newest version from ${BRAND.releases}`,
      );
    }
    expect(github.asked).toEqual([]);
    expect(replaced).toEqual([]);
  });

  it("doesn't update a copy a release didn't build", async () => {
    for (const version of ["0.0.0-dev", "0.1.0-local", ""]) {
      const response = await runSelfUpdate(false, { ...deps, brand: { ...BRAND, version } });
      expect(response.message).toContain("wasn't built by a release");
    }
    expect(github.asked).toEqual([]);
  });

  it("refuses an unsigned release, and says so", async () => {
    github.publish("0.1.7", { "linux-x64": linux }, { seed: null });
    const response = await runSelfUpdate(false, deps);
    expect(response.success).toBe(false);
    expect(response.message).toBe(
      "No release newer than 0.1.5 checked out, so nothing was installed: cli-v0.1.7 is unsigned (it has no manifest.json.sig).",
    );
    expect(replaced).toEqual([]);
  });

  it("refuses a release signed with another key", async () => {
    github.publish("0.1.7", { "linux-x64": linux }, { seed: vectors.otherKey.seed });
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toContain("isn't signed with PassBundle's CLI release key");
    expect(replaced).toEqual([]);
  });

  it.each([
    [
      "another app's",
      (m: Record<string, unknown>) => ({ ...m, app: "com.passbundle.app" }),
      "for another app",
    ],
    [
      "no file for this platform",
      (m: Record<string, unknown>) => ({ ...m, files: [] as unknown[] }),
      "no single file for linux-x64",
    ],
    [
      "another release's tag",
      (m: Record<string, unknown>) => ({ ...m, tag: "cli-v0.1.8" }),
      "another release's",
    ],
  ])("refuses a signed manifest with %s", async (_what, change, said) => {
    github.publish("0.1.7", { "linux-x64": linux }, { manifest: change });
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toContain(said);
    expect(replaced).toEqual([]);
  });

  it("refuses another platform's file, even when it's the only one", async () => {
    github.publish("0.1.7", { "macos-arm64": linux });
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toContain("no single file for linux-x64");
  });

  it("passes over drafts, prereleases, other tags, and older releases, and never asks for GitHub's latest", async () => {
    github.publish("0.1.9", { "linux-x64": linux }, { draft: true });
    github.publish("0.1.8", { "linux-x64": linux }, { prerelease: true });
    github.publish("0.1.4", { "linux-x64": linux });
    github.releases.unshift({
      tag_name: "windows-v9.9.9",
      draft: false,
      prerelease: false,
      assets: [],
    });
    github.releases.unshift({
      tag_name: "cli-v0.1.07",
      draft: false,
      prerelease: false,
      assets: [],
    });
    const response = await runSelfUpdate(false, deps);
    expect(title(response)).toBe("PassBundle CLI 0.1.5 is the newest version.");
    expect(github.asked).toEqual([`https://api.github.com/repos/${REPO}/releases?per_page=100`]);
    expect(github.asked.some((url) => url.includes("latest"))).toBe(false);
  });

  it("offers a real release behind a made-up newer one", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    github.publish("0.1.9", { "linux-x64": tarGz(release()) }, { seed: vectors.otherKey.seed });
    const response = await runSelfUpdate(false, deps);
    expect(title(response)).toBe("Updated the PassBundle CLI from 0.1.5 to 0.1.7.");
    expect(replaced.map((r) => r.version)).toEqual(["0.1.7"]);
  });

  it("refuses a file GitHub's list doesn't give at its exact address, or with another size or SHA-256", async () => {
    for (const listed of [
      (a: Record<string, unknown>) =>
        String(a.name).endsWith(".tar.gz")
          ? { ...a, browser_download_url: "https://example.com/x.tar.gz" }
          : a,
      (a: Record<string, unknown>) => (String(a.name).endsWith(".tar.gz") ? { ...a, size: 12 } : a),
      (a: Record<string, unknown>) =>
        String(a.name).endsWith(".tar.gz") ? { ...a, digest: `sha256:${"0".repeat(64)}` } : a,
    ]) {
      github = new GitHub();
      github.publish("0.1.7", { "linux-x64": linux }, { listed });
      const response = await runSelfUpdate(false, { ...deps, get: github.get });
      expect(response.message).toContain("isn't the one its manifest names");
    }
    expect(replaced).toEqual([]);
  });

  it("refuses a download whose SHA-256 isn't the manifest's", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    const stored =
      "https://release-assets.githubusercontent.com/cli-v0.1.7/passbundle-0.1.7-linux-x64.tar.gz?sig=x";
    const swapped = Buffer.from(linux);
    swapped[swapped.length - 1] ^= 1;
    github.files.set(stored, { status: 200, body: swapped });
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toBe(
      "PassBundle CLI 0.1.7 wasn't installed: passbundle-0.1.7-linux-x64.tar.gz isn't the file its signed manifest names. This copy is unchanged.",
    );
    expect(replaced).toEqual([]);
  });

  it("stops a download that's bigger than its manifest says", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    const stored =
      "https://release-assets.githubusercontent.com/cli-v0.1.7/passbundle-0.1.7-linux-x64.tar.gz?sig=x";
    github.files.set(stored, { status: 200, body: Buffer.concat([linux, Buffer.alloc(1)]) });
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toContain("is bigger than it should be");
    expect(replaced).toEqual([]);
  });

  it.each([
    ["plain HTTP", "http://release-assets.githubusercontent.com/x"],
    ["another host", "https://evil.example/passbundle.tar.gz"],
    ["another port", "https://release-assets.githubusercontent.com:8443/x"],
    ["a user name", "https://user@release-assets.githubusercontent.com/x"],
  ])("refuses a redirect to %s", async (_what, location) => {
    github.publish("0.1.7", { "linux-x64": linux });
    const address = `https://github.com/${REPO}/releases/download/cli-v0.1.7/passbundle-0.1.7-linux-x64.tar.gz`;
    github.files.set(address, { status: 302, location });
    github.files.set(location, { status: 200, body: linux });
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toContain("not GitHub over HTTPS");
    expect(github.asked).not.toContain(location);
    expect(replaced).toEqual([]);
  });

  it("refuses a manifest behind a redirect to plain HTTP", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    const address = `https://github.com/${REPO}/releases/download/cli-v0.1.7/manifest.json`;
    github.files.set(address, { status: 302, location: "http://github.com/manifest.json" });
    const response = await runSelfUpdate(true, deps);
    expect(response.message).toContain("not GitHub over HTTPS");
  });

  it("refuses endless redirects", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    const address = `https://github.com/${REPO}/releases/download/cli-v0.1.7/manifest.json`;
    github.files.set(address, { status: 302, location: address });
    const response = await runSelfUpdate(true, deps);
    expect(response.message).toContain("redirects too often");
  });

  it("stops at a network failure, and changes nothing", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    github.down = true;
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toBe(
      "Couldn't check for updates: couldn't reach GitHub (ECONNREFUSED). Nothing changed.",
    );
    expect(replaced).toEqual([]);
  });

  it("says how to update instead where this copy can't replace itself, and --check still reports", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    refusal =
      "it runs as root. Install the new release the way you installed this one (with sudo, say): x";
    const update = await runSelfUpdate(false, deps);
    expect(update.success).toBe(false);
    expect(update.message).toBe(
      "PassBundle CLI 0.1.7 is available, but this copy can't update itself: it runs as root. Install the new release the way you installed this one (with sudo, say): x",
    );
    expect(github.asked.some((url) => url.includes(".tar.gz"))).toBe(false);
    const check = await runSelfUpdate(true, deps);
    expect(check.success).toBe(true);
    expect(title(check)).toContain(
      "0.1.7 is available (this is 0.1.5). This copy can't update itself: it runs as root.",
    );
    expect(replaced).toEqual([]);
  });

  it("refuses an archive that holds anything but a release's files", async () => {
    github.publish("0.1.7", {
      "linux-x64": tarGz([...release(), { name: "extra", data: program }]),
    });
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toContain("wasn't installed: the release's archive holds");
    expect(replaced).toEqual([]);
  });

  it("says when putting it in place failed, and that this copy is unchanged", async () => {
    github.publish("0.1.7", { "linux-x64": linux });
    deps.replace = () => {
      throw new Error('the new program says it\'s "0.1.6", not 0.1.7');
    };
    const response = await runSelfUpdate(false, deps);
    expect(response.message).toBe(
      "PassBundle CLI 0.1.7 wasn't installed: the new program says it's \"0.1.6\", not 0.1.7. This copy is unchanged.",
    );
  });

  it("takes Windows' .zip", async () => {
    github.publish("0.1.7", { "windows-x64": await zip(release("passbundle.exe")) });
    const response = await runSelfUpdate(false, { ...deps, platform: "windows-x64" });
    expect(response.success).toBe(true);
    expect(replaced).toEqual([{ program, version: "0.1.7" }]);
  });
});
