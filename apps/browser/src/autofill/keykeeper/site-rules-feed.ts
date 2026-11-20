// Keykeeper: reading a signed site rules feed (DESIGN.md, "Fill rules for
// everyone", "Shipping: a signed feed" and "How clients verify"). The feed is
// upstream's Fill Assist format (docs/fill-rules-study.md, "The format") with
// a signature of our own around it: `manifest.json` names the rules file and
// its SHA-256 and adds `passbundle: { sequence, issued, expires }`, and
// `manifest.json.sig` is an Ed25519 signature over "PassBundle site rules
// v1\n" and the manifest's exact bytes (site-rules-signature.ts). Nothing in
// the manifest is read before its signature checks out.
//
// What's taken, for our fill-rules engine: sign-in and change-password forms
// (`account-login`, `account-update`), and of their fields the username (the
// first of `username`, `email`, `phone`), the password, and the one-time
// code, each as CSS selectors tried in order. A bad entry is skipped on its
// own: a selector over 500 characters or with `>>>` into a frame (a frame gets
// its own host's rules; `>>>` into a shadow root is fine), a host with more
// than 20 forms, a rule without an id or a verified date, or one verified more
// than 90 days ago. Kinds of forms and fields the engine doesn't fill yet are
// left out without skipping the rest. Test vectors: docs/vectors/site-rules-v1.json
// in the meta repo (a copy is site-rules-v1.vectors.json here).

import { feedSignatureChecks } from "./site-rules-signature";

/** The kinds of value a feed's rule fills, as our fill rules name them. */
export type SiteRuleKind = "username" | "password" | "totp";

/** One rule (one form) of a feed, as kept: selectors for each kind, tried in order. */
export type SiteRule = {
  id: string;
  /** The page it's for, trailing slashes trimmed ("/" for the root), or null for every page on the host. */
  path: string | null;
  verified: string;
  fields: Partial<Record<SiteRuleKind, string[]>>;
};

/** What the reader keeps of a feed. */
export type SiteRules = {
  sequence: number;
  issued: string;
  expires: string;
  sha256: string;
  hosts: Record<string, SiteRule[]>;
};

/** A manifest whose signature checked out, for this time and the copy kept. */
export type CheckedManifest = {
  sequence: number;
  issued: string;
  expires: string;
  filename: string;
  sha256: string;
};

export type Refusal = "signature" | "malformed" | "rollback" | "expired" | "lifetime" | "hash";

export type Checked<T> =
  { ok: true; value: T; refused?: undefined } | { ok: false; refused: Refusal; value?: undefined };

export const MAX_MANIFEST = 64 * 1024;
export const MAX_RULES_FILE = 4 * 1024 * 1024;
export const MAX_SELECTOR = 500;
export const MAX_FORMS_PER_HOST = 20;
/** The most alternatives a field may list; past it, the rest are left out. */
const MAX_ALTERNATIVES = 10;
const DAY = 24 * 60 * 60 * 1000;
/** A feed expires at most 14 days after it's issued. */
export const MAX_LIFETIME = 14 * DAY;
/** A rule is dropped once its verified date is more than 90 days old. */
export const MAX_RULE_AGE = 90 * DAY;
/** How far ahead of the clock an issued or verified date may be. */
const CLOCK_SKEW = DAY;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.json$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RULE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9]\d{0,4})?$/;
const CATEGORIES = new Set(["account-login", "account-update"]);
/** Upstream's field keys for the username, in the order upstream's fill tries them. */
const USERNAME_KEYS = ["username", "email", "phone"];

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const refuse = <T>(refused: Refusal): Checked<T> => ({ ok: false, refused });

/** A time as the feed writes it (2026-11-18T00:00:00Z), or NaN. */
function timeOf(text: unknown): number {
  if (typeof text !== "string" || !ISO_TIME.test(text)) {
    return NaN;
  }
  const time = Date.parse(text);
  return !Number.isNaN(time) && new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z") === text
    ? time
    : NaN;
}

/** A date as the feed writes it (2026-11-15), as its midnight UTC, or NaN. */
function dateOf(text: unknown): number {
  if (typeof text !== "string" || !ISO_DATE.test(text)) {
    return NaN;
  }
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text ? time : NaN;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value != null && !Array.isArray(value);

/** A page's path as rules match it: trailing slashes trimmed, the root as "/". */
export function rulePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Whether a selector crosses `>>>` into a frame: a part before a `>>>` whose
 * last element is named as an iframe or a frame. The content script refuses
 * any crossing into a frame too, whatever the selector calls it.
 */
function crossesIntoFrame(selector: string): boolean {
  const parts = selector.split(">>>");
  return parts.slice(0, -1).some((part) => {
    const compounds = part.trim().split(/[\s>+~]+/);
    const last = compounds[compounds.length - 1] ?? "";
    const type = /^(?:[A-Za-z*]*\|)?([A-Za-z][A-Za-z0-9-]*)/.exec(last)?.[1]?.toLowerCase();
    return type === "iframe" || type === "frame";
  });
}

/** Whether a selector may be taken: text, at most 500 characters, and no `>>>` into a frame. */
function selectorIsGood(selector: unknown): selector is string {
  return (
    typeof selector === "string" &&
    selector.trim() !== "" &&
    selector.length <= MAX_SELECTOR &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(selector) &&
    !crossesIntoFrame(selector)
  );
}

/**
 * A form as a rule, or "skip" when it's a bad entry, or null when it's good
 * but has nothing the engine fills yet.
 */
function ruleOf(form: unknown, path: string | null, now: number): SiteRule | "skip" | null {
  if (!isObject(form) || !isObject(form.passbundle) || !isObject(form.fields)) {
    return "skip";
  }
  const { id, verified } = form.passbundle;
  const verifiedAt = dateOf(verified);
  if (typeof id !== "string" || !RULE_ID.test(id) || Number.isNaN(verifiedAt)) {
    return "skip";
  }
  if (verifiedAt > now + CLOCK_SKEW) {
    return "skip";
  }
  // Every selector the form names must be good, even for kinds we don't fill.
  for (const alternatives of Object.values(form.fields)) {
    if (!Array.isArray(alternatives)) {
      return "skip";
    }
    for (const alternative of alternatives) {
      const parts = Array.isArray(alternative) ? alternative : [alternative];
      if (parts.length === 0 || !parts.every(selectorIsGood)) {
        return "skip";
      }
    }
  }
  if (now - verifiedAt > MAX_RULE_AGE) {
    // Nobody checked it again in time: dropped (DESIGN.md, "Checking shipped rules ahead of time").
    return null;
  }
  if (typeof form.category !== "string" || !CATEGORIES.has(form.category)) {
    return null;
  }
  // One value in several inputs (a list of selectors) isn't filled yet.
  const selectors = (key: string): string[] =>
    ((form.fields as Record<string, unknown[]>)[key] ?? [])
      .filter((a): a is string => typeof a === "string")
      .slice(0, MAX_ALTERNATIVES);
  const fields: SiteRule["fields"] = {};
  const username = USERNAME_KEYS.map(selectors).find((list) => list.length > 0);
  if (username) {
    fields.username = username;
  }
  if (selectors("password").length) {
    fields.password = selectors("password");
  }
  if (selectors("oneTimeCode").length) {
    fields.totp = selectors("oneTimeCode");
  }
  if (Object.keys(fields).length === 0) {
    return null;
  }
  return { id, path, verified: verified as string, fields };
}

/** A host's entry as rules, or null when the entry is bad (or turns the host off, which isn't taken). */
function hostRules(entry: unknown, now: number): SiteRule[] | null {
  if (!isObject(entry)) {
    return null;
  }
  const forms: { form: unknown; path: string | null }[] = [];
  if (entry.forms !== undefined) {
    if (!Array.isArray(entry.forms)) {
      return null;
    }
    forms.push(...entry.forms.map((form) => ({ form, path: null as string | null })));
  }
  if (entry.pathnames !== undefined) {
    if (!isObject(entry.pathnames)) {
      return null;
    }
    for (const [path, page] of Object.entries(entry.pathnames)) {
      // A page set to null turns autofill off there in upstream's format, which isn't taken.
      if (
        !path.startsWith("/") ||
        path.length > 2048 ||
        !isObject(page) ||
        !Array.isArray(page.forms)
      ) {
        continue;
      }
      forms.push(...page.forms.map((form) => ({ form, path: rulePath(path) })));
    }
  }
  if (forms.length > MAX_FORMS_PER_HOST) {
    return null;
  }
  const rules: SiteRule[] = [];
  for (const { form, path } of forms) {
    const rule = ruleOf(form, path, now);
    if (rule != null && rule !== "skip") {
      rules.push(rule);
    }
  }
  return rules;
}

/**
 * Checks a manifest: signed by one of `keys` (strictly), then naming a rules
 * file and its SHA-256, with a sequence no lower than the copy kept
 * (`lastSequence`), and not expired at `now`, with at most 14 days from
 * issued to expires.
 */
export function checkManifest(
  manifest: Uint8Array,
  signatureFile: string,
  keys: readonly string[],
  lastSequence: number | null,
  now: number,
): Checked<CheckedManifest> {
  if (manifest.length > MAX_MANIFEST || !feedSignatureChecks(manifest, signatureFile, keys)) {
    return refuse("signature");
  }
  // Only now, signed, is it worth reading.
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest));
  } catch {
    return refuse("malformed");
  }
  if (!isObject(raw) || !isObject(raw.passbundle)) {
    return refuse("malformed");
  }
  const forms = isObject(raw.maps) && isObject(raw.maps.forms) ? raw.maps.forms.v1 : undefined;
  if (!isObject(forms)) {
    return refuse("malformed");
  }
  const { filename, sha256 } = forms;
  const { sequence, issued, expires } = raw.passbundle;
  if (
    typeof filename !== "string" ||
    !FILENAME.test(filename) ||
    filename === "manifest.json" ||
    typeof sha256 !== "string" ||
    !SHA256.test(sha256) ||
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  ) {
    return refuse("malformed");
  }
  const issuedAt = timeOf(issued);
  const expiresAt = timeOf(expires);
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) {
    return refuse("malformed");
  }
  if (lastSequence != null && sequence < lastSequence) {
    return refuse("rollback");
  }
  if (now >= expiresAt) {
    return refuse("expired");
  }
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME || issuedAt > now + CLOCK_SKEW) {
    return refuse("lifetime");
  }
  return ok({ sequence, issued: issued as string, expires: expires as string, filename, sha256 });
}

/** The SHA-256 of some bytes, in lowercase hex. */
export async function sha256Hex(
  data: Uint8Array,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
  const digest = new Uint8Array(await subtle.digest("SHA-256", new Uint8Array(data)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Reads the rules file a checked manifest names: its bytes must be the ones
 * the manifest's SHA-256 names, then each host and form is taken or skipped
 * on its own.
 */
export async function readRules(
  file: Uint8Array,
  manifest: CheckedManifest,
  now: number,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<Checked<SiteRules>> {
  if (file.length > MAX_RULES_FILE || (await sha256Hex(file, subtle)) !== manifest.sha256) {
    return refuse("hash");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file));
  } catch {
    return refuse("malformed");
  }
  if (!isObject(raw) || !isObject(raw.hosts)) {
    return refuse("malformed");
  }
  const hosts: Record<string, SiteRule[]> = {};
  for (const [host, entry] of Object.entries(raw.hosts)) {
    if (host.length > 260 || !HOST.test(host)) {
      continue;
    }
    const rules = hostRules(entry, now);
    if (rules?.length) {
      hosts[host] = rules;
    }
  }
  return ok({
    sequence: manifest.sequence,
    issued: manifest.issued,
    expires: manifest.expires,
    sha256: manifest.sha256,
    hosts,
  });
}

/**
 * The rules of a kept copy for one page: its host's rules for every page and
 * for this path, without any whose verified date has passed 90 days since it
 * was kept. None once the copy has expired.
 */
export function rulesForPage(
  rules: SiteRules,
  host: string,
  path: string,
  now: number,
): SiteRule[] {
  if (now >= timeOf(rules.expires) || !Object.prototype.hasOwnProperty.call(rules.hosts, host)) {
    return [];
  }
  const page = rulePath(path);
  return rules.hosts[host].filter(
    (rule) =>
      (rule.path == null || rule.path === page) && now - dateOf(rule.verified) <= MAX_RULE_AGE,
  );
}

/** Whether a kept copy has expired. */
export function hasExpired(rules: Pick<SiteRules, "expires">, now: number): boolean {
  const expires = timeOf(rules.expires);
  return Number.isNaN(expires) || now >= expires;
}
