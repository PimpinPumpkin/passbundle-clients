/**
 * @jest-environment node
 */
// Node's environment, not jsdom's: node-forge's Ed25519 tells bytes apart by
// `instanceof ArrayBuffer`, which jsdom's second set of globals breaks. The
// extension has one set, as here.
import { webcrypto } from "node:crypto";

import {
  checkManifest,
  type Checked,
  readRules,
  rulesForPage,
  type SiteRules,
} from "./site-rules-feed";
import { PASSBUNDLE_SITE_RULES_KEYS } from "./site-rules-keys";
import vectors from "./site-rules-v1.vectors.json";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const utf8 = (text: string) => new TextEncoder().encode(text);

type Case = {
  name: string;
  manifest: string;
  signature: string;
  rules?: string;
  keys?: string[];
  lastSequence?: number;
  now?: string;
  taken?: SiteRules;
  refused?: string;
};

/** Reads a vector's feed as the extension does: the manifest first, then the rules file it names. */
async function read(c: Case): Promise<Checked<SiteRules>> {
  const now = Date.parse(c.now ?? vectors.now);
  const manifest = checkManifest(
    utf8(c.manifest),
    c.signature,
    c.keys ?? [vectors.key.public],
    c.lastSequence ?? null,
    now,
  );
  if (!manifest.ok) {
    return { ok: false, refused: manifest.refused };
  }
  if (c.rules == null) {
    throw new Error(`${c.name}: the manifest checked out, but the vector has no rules file`);
  }
  return readRules(utf8(c.rules), manifest.value, now, subtle);
}

describe("site rules feed (docs/vectors/site-rules-v1.json)", () => {
  it("has every case the design asks for", () => {
    const refusals = new Set((vectors.cases as Case[]).map((c) => c.refused).filter(Boolean));
    expect([...refusals].sort()).toEqual(
      ["expired", "hash", "lifetime", "malformed", "rollback", "signature"].sort(),
    );
    expect(vectors.key.testOnly).toBe(true);
    expect(vectors.otherKey.testOnly).toBe(true);
  });

  it.each((vectors.cases as Case[]).map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const result = await read(c);
    if (c.refused) {
      expect(result).toEqual({ ok: false, refused: c.refused });
    } else {
      expect(result).toEqual({ ok: true, value: c.taken });
    }
  });

  it("never trusts the vectors' test keys in the key list a build ships", () => {
    expect(PASSBUNDLE_SITE_RULES_KEYS).not.toContain(vectors.key.public);
    expect(PASSBUNDLE_SITE_RULES_KEYS).not.toContain(vectors.otherKey.public);
    // Empty until the owner adds PassBundle's public key (DESIGN.md, "Fill rules for everyone", Decisions, 5).
    expect(PASSBUNDLE_SITE_RULES_KEYS).toEqual([]);
  });

  describe("a kept copy, for one page", () => {
    const good = (vectors.cases as Case[]).find((c) => c.name === "as signed")!.taken!;
    const at = (time: string) => Date.parse(time);

    it("has the host's rules for every page, and a path's rules on that page only", () => {
      expect(
        rulesForPage(good, "login.example.test", "/anything", at(vectors.now)).map((r) => r.id),
      ).toEqual(["login-shadow"]);
      expect(
        rulesForPage(good, "bank.example.test", "/sign-in", at(vectors.now)).map((r) => r.id),
      ).toEqual(["bank-sign-in"]);
      expect(rulesForPage(good, "bank.example.test", "/sign-in///", at(vectors.now))).toHaveLength(
        1,
      );
      expect(rulesForPage(good, "bank.example.test", "/sign-in/more", at(vectors.now))).toEqual([]);
      expect(rulesForPage(good, "bank.example.test", "/", at(vectors.now))).toEqual([]);
      expect(rulesForPage(good, "elsewhere.example.test", "/", at(vectors.now))).toEqual([]);
      // Hosts are matched exactly, a port included.
      expect(rulesForPage(good, "login.example.test:8443", "/", at(vectors.now))).toEqual([]);
    });

    it("has none once the copy expires, and drops a rule once it's past 90 days", () => {
      expect(rulesForPage(good, "login.example.test", "/", at("2026-12-02T00:00:00Z"))).toEqual([]);
      // The bank's rule was verified on October 1: past 90 days on December 30. A
      // copy with a later expiry (another feed) still drops it then.
      const later = { ...good, expires: "2027-01-10T00:00:00Z" };
      expect(
        rulesForPage(later, "bank.example.test", "/sign-in", at("2026-12-30T00:00:00Z")),
      ).toHaveLength(1);
      expect(
        rulesForPage(later, "bank.example.test", "/sign-in", at("2026-12-30T00:00:01Z")),
      ).toEqual([]);
    });

    it("doesn't take a host named like one of Object's own properties", () => {
      expect(rulesForPage(good, "constructor", "/", at(vectors.now))).toEqual([]);
      expect(rulesForPage(good, "__proto__", "/", at(vectors.now))).toEqual([]);
    });
  });
});
