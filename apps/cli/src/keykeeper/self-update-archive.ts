// Keykeeper: the program out of a release's archive, for `passbundle update`
// (self-update.ts; DESIGN.md, "Updating itself", step 7). A release's archive
// holds exactly three plain files at its top: the program, LICENSE.txt, and
// README.txt (cli-release.yml checks the same before it signs). Anything else
// (another file, a folder, a link, a path with "..") is refused, and nothing
// is unpacked past 400 MB. Read in memory; nothing is written. The archive's
// SHA-256 is checked against the signed manifest before it gets here, so
// this is a second check, not the first.

import { crc32, gunzipSync, inflateRawSync } from "zlib";

import { UpdateRefusal } from "./self-update";

/** The most a release's program unpacks to. */
export const MAX_PROGRAM = 400 * 1024 * 1024;
const MAX_OTHER = 1024 * 1024;

/** What a release's archive holds, by the program's name. */
function expectedNames(program: string): string[] {
  return [program, "LICENSE.txt", "README.txt"].sort();
}

function refuse(why: string): never {
  throw new UpdateRefusal("download", `the release's archive ${why}`);
}

/** The program from a release's archive: a .tar.gz on macOS and Linux, a .zip on Windows. */
export function programFromArchive(
  archive: Buffer,
  kind: "tar.gz" | "zip",
  program: string,
): Buffer {
  const files = kind === "zip" ? readZip(archive) : readTar(gunzip(archive));
  const names = [...files.keys()].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames(program))) {
    refuse(`holds ${names.join(", ") || "nothing"}, not ${expectedNames(program).join(", ")}`);
  }
  const bytes = files.get(program)!;
  if (bytes.length === 0) {
    refuse("holds an empty program");
  }
  return bytes;
}

function gunzip(archive: Buffer): Buffer {
  try {
    return gunzipSync(archive, { maxOutputLength: MAX_PROGRAM + 3 * MAX_OTHER });
  } catch (e) {
    if (e instanceof RangeError || (e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      refuse("unpacks to more than any release");
    }
    refuse("isn't a gzip file");
  }
}

function octal(field: Buffer): number {
  const text = field
    .toString("latin1")
    .replace(/\0[\s\S]*$/, "")
    .trim();
  if (!/^[0-7]+$/.test(text)) {
    refuse("has an entry it can't read");
  }
  return parseInt(text, 8);
}

function cString(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

/** Only a name at the archive's top, as a release writes it. */
function plainName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== "." && name !== "..";
}

/** Each file in a tar archive (ustar, GNU, or pax), by name; anything but a plain file is refused. */
function readTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      // The end: everything after is padding.
      if (!tar.subarray(offset).every((b) => b === 0)) {
        refuse("has data after its end");
      }
      return files;
    }
    const sum = header.reduce((total, b, i) => total + (i >= 148 && i < 156 ? 32 : b), 0);
    if (sum !== octal(header.subarray(148, 156))) {
      refuse("has an entry it can't read");
    }
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      refuse("ends in the middle of an entry");
    }
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "g") {
      // A pax header: times or attributes only. One that renames the next
      // entry, links it, or changes its size isn't read the same way by
      // every tar, so it's refused.
      for (const record of data.toString("utf8").split("\n")) {
        const key = /^\d+ ([^=]+)=/.exec(record)?.[1];
        if (key != null && /^(path|linkpath|size|GNU\.sparse\..*)$/.test(key)) {
          refuse("renames or resizes an entry");
        }
      }
      continue;
    }
    if (type !== "0") {
      refuse("holds something that isn't a plain file (a folder or a link)");
    }
    const prefix = cString(header.subarray(345, 500));
    const name = cString(header.subarray(0, 100));
    if (prefix !== "" || !plainName(name)) {
      refuse(
        `holds ${JSON.stringify(prefix ? `${prefix}/${name}` : name)}, which isn't at its top`,
      );
    }
    if (files.has(name)) {
      refuse(`holds ${name} twice`);
    }
    files.set(name, Buffer.from(data));
  }
  refuse("has no end");
}

/** Each file in a zip archive, by name; anything but a plain file at its top is refused. */
function readZip(zip: Buffer): Map<string, Buffer> {
  // The end of central directory record, in the last 64 KB.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    refuse("isn't a zip file");
  }
  const count = zip.readUInt16LE(end + 10);
  const directorySize = zip.readUInt32LE(end + 12);
  let at = zip.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff || at + directorySize > end) {
    refuse("isn't a zip file a release makes");
  }
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== 0x02014b50) {
      refuse("has an entry it can't read");
    }
    const madeBy = zip.readUInt8(at + 5);
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const externalAttributes = zip.readUInt32LE(at + 38);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;

    // Unix permissions, when the entry has them: only a plain file.
    const unixMode = externalAttributes >>> 16;
    const isUnix = madeBy === 3;
    if (
      name.endsWith("/") ||
      (externalAttributes & 0x10) !== 0 ||
      (isUnix && unixMode !== 0 && (unixMode & 0o170000) !== 0o100000)
    ) {
      refuse("holds something that isn't a plain file (a folder or a link)");
    }
    if (!plainName(name)) {
      refuse(`holds ${JSON.stringify(name)}, which isn't at its top`);
    }
    if ((flags & 0x1) !== 0) {
      refuse("is encrypted");
    }
    if (files.has(name)) {
      refuse(`holds ${name} twice`);
    }
    const max = name.endsWith(".exe") ? MAX_PROGRAM : MAX_OTHER;
    if (size > max || compressedSize === 0xffffffff || size === 0xffffffff) {
      refuse("unpacks to more than any release");
    }
    if (localAt + 30 > zip.length || zip.readUInt32LE(localAt) !== 0x04034b50) {
      refuse("has an entry it can't read");
    }
    const dataStart =
      localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    if (dataStart + compressedSize > zip.length) {
      refuse("ends in the middle of an entry");
    }
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: max });
      } catch {
        refuse("has an entry it can't unpack");
      }
    } else {
      refuse("uses a kind of compression a release doesn't");
    }
    if (data.length !== size || crc32(data) !== crc) {
      refuse("has an entry that doesn't unpack as it says");
    }
    files.set(name, data);
  }
  return files;
}
