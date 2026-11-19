// Keykeeper: `passbundle update` (DESIGN.md, "Command-line tool", "Updating
// itself", in the meta repo). The tool takes a release only if its manifest is
// signed with a CLI release key compiled into it (brand.json's
// `cli.releaseKeys`), over "PassBundle CLI release v1\n" and the manifest's
// exact bytes, and the manifest names this platform's archive, whose size and
// SHA-256 the download must match. The checks are the desktop updater's
// ("Desktop updates"), in the same order. Nothing here checks by itself: only
// someone running `update` does. Unpacking is self-update-archive.ts, and
// putting the program in place self-update-install.ts.

import { createHash, createPublicKey, verify } from "crypto";

import { CliBrand } from "./brand";

/** What's signed: this, then the manifest's exact bytes. */
export const SIGNED_PREFIX = "PassBundle CLI release v1\n";
export const APP_ID = "com.passbundle.cli";

/** Hosts a release's files may come from, every redirect included. */
export const DOWNLOAD_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const API_HOST = "api.github.com";

export const MAX_RELEASE_LIST = 5 * 1024 * 1024;
export const MAX_MANIFEST = 256 * 1024;
export const MAX_SIGNATURE = 1024;
export const MAX_ARCHIVE = 200 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** Releases tried, newest first. */
const MAX_CANDIDATES = 10;

/** The platforms releases are built for, by Node's names. */
export function platformName(platform: string, arch: string): string | null {
  const names: Record<string, string> = {
    "darwin-arm64": "macos-arm64",
    "darwin-x64": "macos-x64",
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "win32-x64": "windows-x64",
  };
  return names[`${platform}-${arch}`] ?? null;
}

export type Version = [number, number, number];

/** A release's version (digits only, no leading zeros), or null. */
export function releaseVersion(version: string): Version | null {
  const match = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewer(a: Version, b: Version): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}

/** Why a release (or the whole update) is refused; `kind` is the vectors' name for it. */
export class UpdateRefusal extends Error {
  constructor(
    readonly kind:
      | "signature"
      | "unsigned"
      | "malformed"
      | "app"
      | "tag"
      | "version"
      | "notNewer"
      | "noFile"
      | "name"
      | "tooLarge"
      | "address"
      | "listed"
      | "download",
    message: string,
  ) {
    super(message);
  }
}

/** A network failure or an answer GitHub shouldn't give: it stops the check. */
export class UpdateNetworkError extends Error {}

export type ManifestFile = { name: string; platform: string; size: number; sha256: string };
export type Manifest = {
  format: 1;
  app: string;
  tag: string;
  version: string;
  commit?: string;
  notes?: string;
  files: ManifestFile[];
};

/** Ed25519 (pure, RFC 8032) with one of the pinned keys, over the prefix and the manifest's bytes. */
export function signatureChecks(manifest: Buffer, signature: string, keys: string[]): boolean {
  const trimmed = signature.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(trimmed)) {
    return false;
  }
  const raw = Buffer.from(trimmed, "base64");
  if (raw.length !== 64) {
    return false;
  }
  const signed = Buffer.concat([Buffer.from(SIGNED_PREFIX, "utf8"), manifest]);
  return keys.some((key) => {
    if (!/^[0-9a-f]{64}$/.test(key)) {
      return false;
    }
    try {
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(key, "hex"),
        ]),
        format: "der",
        type: "spki",
      });
      return verify(null, signed, publicKey, raw);
    } catch {
      return false;
    }
  });
}

/** What a release's archive for this platform is called. */
export function archiveName(version: string, platform: string): string {
  return `passbundle-${version}-${platform}.${platform === "windows-x64" ? "zip" : "tar.gz"}`;
}

/**
 * Checks a manifest (steps 3 and 4): signed with a pinned key, then read: for
 * this tool, for the tag it was found on, at that tag's version, newer than
 * this copy, with exactly one file for this platform, named as a release
 * names it, of a size a release can have, with a SHA-256. Returns the
 * manifest and that file, or throws an UpdateRefusal.
 */
export function checkManifest(
  bytes: Buffer,
  signature: string,
  keys: string[],
  expect: { tag: string; platform: string; running: string },
): { manifest: Manifest; file: ManifestFile } {
  if (!signatureChecks(bytes, signature, keys)) {
    throw new UpdateRefusal(
      "signature",
      `${expect.tag}'s manifest isn't signed with PassBundle's CLI release key`,
    );
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new UpdateRefusal("malformed", `${expect.tag}'s manifest isn't one the tool can read`);
  }
  if (
    manifest == null ||
    typeof manifest !== "object" ||
    manifest.format !== 1 ||
    typeof manifest.app !== "string" ||
    typeof manifest.tag !== "string" ||
    typeof manifest.version !== "string" ||
    !Array.isArray(manifest.files)
  ) {
    throw new UpdateRefusal("malformed", `${expect.tag}'s manifest isn't one the tool can read`);
  }
  if (manifest.app !== APP_ID) {
    throw new UpdateRefusal("app", `${expect.tag}'s manifest is for another app`);
  }
  if (manifest.tag !== expect.tag) {
    throw new UpdateRefusal("tag", `${expect.tag}'s manifest is another release's`);
  }
  const version = releaseVersion(manifest.version);
  if (version == null || `cli-v${manifest.version}` !== expect.tag) {
    throw new UpdateRefusal("version", `${expect.tag}'s manifest names another version`);
  }
  const running = releaseVersion(expect.running);
  if (running == null || !isNewer(version, running)) {
    throw new UpdateRefusal("notNewer", `${expect.tag} isn't newer than ${expect.running}`);
  }
  const files = manifest.files.filter((f) => f != null && f.platform === expect.platform);
  if (files.length !== 1) {
    throw new UpdateRefusal("noFile", `${expect.tag} has no single file for ${expect.platform}`);
  }
  const file = files[0];
  if (file.name !== archiveName(manifest.version, expect.platform)) {
    throw new UpdateRefusal("name", `${expect.tag}'s file for ${expect.platform} has another name`);
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_ARCHIVE) {
    throw new UpdateRefusal("tooLarge", `${expect.tag}'s file for ${expect.platform} is too large`);
  }
  if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) {
    throw new UpdateRefusal("malformed", `${expect.tag}'s manifest has no SHA-256 for its file`);
  }
  return { manifest, file };
}

/** One answer from the network, before any redirect is followed. */
export type Fetched = {
  status: number;
  /** The Location header, for a redirect. */
  location: string | null;
  body: AsyncIterable<Uint8Array>;
};

/** Gets an address without following redirects. */
export type Getter = (url: string, accept: string) => Promise<Fetched>;

function allowed(url: URL, hosts: ReadonlySet<string>): boolean {
  return (
    url.protocol === "https:" &&
    hosts.has(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

/** Reads a body, at most `max` bytes (more is refused), hashing it as it arrives. */
async function readCapped(
  body: AsyncIterable<Uint8Array>,
  max: number,
  what: string,
): Promise<{ bytes: Buffer; sha256: string }> {
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of body) {
    length += chunk.length;
    if (length > max) {
      throw new UpdateRefusal("download", `${what} is bigger than it should be`);
    }
    hash.update(chunk);
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks, length), sha256: hash.digest("hex") };
}

/**
 * Gets a file at exactly this address, following at most 5 redirects, each
 * over HTTPS to one of `hosts` (no other port, no user name). Null when it
 * isn't there (404).
 */
export async function getFile(
  get: Getter,
  address: string,
  hosts: ReadonlySet<string>,
  max: number,
  what: string,
  redirects = MAX_REDIRECTS,
): Promise<{ bytes: Buffer; sha256: string } | null> {
  let url = new URL(address);
  for (let i = 0; ; i++) {
    if (!allowed(url, hosts)) {
      throw new UpdateRefusal(
        "address",
        `${what} would come from ${url.origin}, not GitHub over HTTPS`,
      );
    }
    let answer: Fetched;
    try {
      answer = await get(url.toString(), "application/octet-stream");
    } catch (e) {
      throw new UpdateNetworkError(`couldn't reach ${url.hostname} (${(e as Error).message})`);
    }
    if ([301, 302, 303, 307, 308].includes(answer.status)) {
      if (i >= redirects || answer.location == null) {
        throw new UpdateRefusal("address", `${what} redirects too often`);
      }
      url = new URL(answer.location, url);
      continue;
    }
    if (answer.status === 404) {
      return null;
    }
    if (answer.status !== 200) {
      throw new UpdateNetworkError(`${url.hostname} answered ${answer.status} for ${what}`);
    }
    try {
      return await readCapped(answer.body, max, what);
    } catch (e) {
      if (e instanceof UpdateRefusal) {
        throw e;
      }
      throw new UpdateNetworkError(`${what} didn't arrive whole (${(e as Error).message})`);
    }
  }
}

type GitHubAsset = {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
};
type GitHubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

export type Candidate = { tag: string; version: Version; assets: GitHubAsset[] };

/**
 * Step 1: the repository's releases, from GitHub's API only: the non-draft,
 * non-prerelease ones tagged cli-v<version>, newer than this copy, newest
 * first, at most 10.
 */
export async function listCandidates(
  get: Getter,
  repository: string,
  running: Version,
): Promise<Candidate[]> {
  const address = `https://${API_HOST}/repos/${repository}/releases?per_page=100`;
  let answer: Fetched;
  try {
    answer = await get(address, "application/vnd.github+json");
  } catch (e) {
    throw new UpdateNetworkError(`couldn't reach GitHub (${(e as Error).message})`);
  }
  if (answer.status !== 200) {
    throw new UpdateNetworkError(`GitHub answered ${answer.status} for the list of releases`);
  }
  let releases: unknown;
  try {
    const { bytes } = await readCapped(answer.body, MAX_RELEASE_LIST, "GitHub's list of releases");
    releases = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    throw new UpdateNetworkError(
      `GitHub's list of releases didn't arrive whole (${(e as Error).message})`,
    );
  }
  if (!Array.isArray(releases)) {
    throw new UpdateNetworkError("GitHub's list of releases isn't a list");
  }
  const candidates: Candidate[] = [];
  for (const release of releases as GitHubRelease[]) {
    if (release == null || release.draft !== false || release.prerelease !== false) {
      continue;
    }
    const tag = release.tag_name;
    if (typeof tag !== "string" || !tag.startsWith("cli-v")) {
      continue;
    }
    const version = releaseVersion(tag.slice("cli-v".length));
    if (version == null || !isNewer(version, running)) {
      continue;
    }
    candidates.push({ tag, version, assets: Array.isArray(release.assets) ? release.assets : [] });
  }
  candidates.sort((a, b) =>
    isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0,
  );
  return candidates.slice(0, MAX_CANDIDATES);
}

/** A release file's address, exactly. */
export function downloadAddress(repository: string, tag: string, name: string): string {
  return `https://github.com/${repository}/releases/download/${tag}/${name}`;
}

function listedAsset(candidate: Candidate, repository: string, name: string): GitHubAsset | null {
  const address = downloadAddress(repository, candidate.tag, name);
  return (
    candidate.assets.find(
      (a) => a != null && a.name === name && a.browser_download_url === address,
    ) ?? null
  );
}

export type Found = {
  tag: string;
  manifest: Manifest;
  file: ManifestFile;
  address: string;
};

export type UpdateContext = {
  brand: Pick<CliBrand, "releaseRepository" | "releaseKeys">;
  /** This copy's version, a release's. */
  running: string;
  platform: string;
  get: Getter;
};

/**
 * Steps 1 to 5: the newest release that checks out, or null when none is
 * newer. A release that doesn't check out is passed over for the next; when
 * none does, the newest one's reason is thrown.
 */
export async function findUpdate(context: UpdateContext): Promise<Found | null> {
  const { brand, platform, get } = context;
  const running = releaseVersion(context.running);
  if (running == null) {
    throw new UpdateRefusal("version", `${context.running} isn't a release's version`);
  }
  const repository = brand.releaseRepository;
  const candidates = await listCandidates(get, repository, running);
  let first: UpdateRefusal | null = null;
  for (const candidate of candidates) {
    try {
      return await checkCandidate(candidate, context);
    } catch (e) {
      if (!(e instanceof UpdateRefusal)) {
        throw e;
      }
      first ??= e;
    }
  }
  if (first != null) {
    throw first;
  }
  return null;

  async function checkCandidate(candidate: Candidate, ctx: UpdateContext): Promise<Found> {
    // Step 2: the manifest and its signature, each where the list says.
    const manifestAsset = listedAsset(candidate, repository, "manifest.json");
    if (manifestAsset == null) {
      throw new UpdateRefusal("malformed", `${candidate.tag} has no manifest`);
    }
    const signatureAsset = listedAsset(candidate, repository, "manifest.json.sig");
    if (signatureAsset == null) {
      throw new UpdateRefusal(
        "unsigned",
        `${candidate.tag} is unsigned (it has no manifest.json.sig)`,
      );
    }
    const manifestFile = await getFile(
      get,
      manifestAsset.browser_download_url as string,
      DOWNLOAD_HOSTS,
      MAX_MANIFEST,
      `${candidate.tag}'s manifest`,
    );
    const signatureFile = await getFile(
      get,
      signatureAsset.browser_download_url as string,
      DOWNLOAD_HOSTS,
      MAX_SIGNATURE,
      `${candidate.tag}'s signature`,
    );
    if (manifestFile == null) {
      throw new UpdateRefusal("malformed", `${candidate.tag} has no manifest`);
    }
    if (signatureFile == null) {
      throw new UpdateRefusal(
        "unsigned",
        `${candidate.tag} is unsigned (it has no manifest.json.sig)`,
      );
    }
    // Steps 3 and 4.
    const { manifest, file } = checkManifest(
      manifestFile.bytes,
      signatureFile.bytes.toString("utf8"),
      ctx.brand.releaseKeys,
      { tag: candidate.tag, platform, running: ctx.running },
    );
    // Step 5: GitHub's own list agrees.
    const archive = listedAsset(candidate, repository, file.name);
    if (archive == null || archive.size !== file.size) {
      throw new UpdateRefusal("listed", `${candidate.tag}'s file isn't the one its manifest names`);
    }
    if (archive.digest != null && archive.digest !== `sha256:${file.sha256}`) {
      throw new UpdateRefusal("listed", `${candidate.tag}'s file isn't the one its manifest names`);
    }
    return {
      tag: candidate.tag,
      manifest,
      file,
      address: downloadAddress(repository, candidate.tag, file.name),
    };
  }
}

/** Step 6: the archive, with the manifest's size and SHA-256, held in memory. */
export async function downloadArchive(get: Getter, found: Found): Promise<Buffer> {
  const got = await getFile(get, found.address, DOWNLOAD_HOSTS, found.file.size, found.file.name);
  if (got == null) {
    throw new UpdateRefusal("download", `${found.file.name} isn't there`);
  }
  if (got.bytes.length !== found.file.size || got.sha256 !== found.file.sha256) {
    throw new UpdateRefusal(
      "download",
      `${found.file.name} isn't the file its signed manifest names`,
    );
  }
  return got.bytes;
}

/** Text from a release, fit for a terminal: no control characters but new lines and tabs. */
export function printable(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "");
}
