import { meetsRules, rulesForHost } from "@bitwarden/common/tools/keykeeper/password-rules";

import { GeneratedCredential } from "../types";

import { forSiteRules, websiteHost } from "./site-rules";

const at = new Date(2026, 9, 20);

describe("forSiteRules", () => {
  it("remakes a password the page's site would reject, keeping when and why it was made", () => {
    const generated = new GeneratedCredential("abc^^^DEF&*123xy", "password", at, "inline-menu");

    const result = forSiteRules(generated, "https://secure.chase.com/signup");

    expect(result.credential).not.toBe(generated.credential);
    expect(result.credential).toHaveLength(16);
    expect(meetsRules(result.credential, rulesForHost("chase.com")!)).toBe(true);
    expect(result.category).toBe("password");
    expect(result.generationDate).toEqual(at);
    expect(result.source).toBe("inline-menu");
  });

  it("keeps a password the site accepts, and any password for a site without rules", () => {
    const accepted = new GeneratedCredential("Abcdefgh1234!xyz", "password", at);
    expect(forSiteRules(accepted, "https://chase.com/")).toBe(accepted);

    const elsewhere = new GeneratedCredential("abc^^^DEF&*123xy", "password", at);
    expect(forSiteRules(elsewhere, "https://bank.example.test/")).toBe(elsewhere);
    expect(forSiteRules(elsewhere, undefined)).toBe(elsewhere);
  });

  it("leaves usernames and email addresses alone", () => {
    const username = new GeneratedCredential("^^^^^^", "username", at);
    expect(forSiteRules(username, "https://chase.com/")).toBe(username);
    const email = new GeneratedCredential("a^^^^b@example.test", "email", at);
    expect(forSiteRules(email, "https://chase.com/")).toBe(email);
  });
});

describe("websiteHost", () => {
  it.each([
    ["https://www.Chase.com/login?x=1", "www.chase.com"],
    ["chase.com", "chase.com"],
    ["chase.com/login", "chase.com"],
    ["http://intranet.example:8080/", "intranet.example:8080"],
    ["", ""],
    [null, ""],
    ["androidapp://com.example.app", ""],
  ])("%s is %s", (website, host) => {
    expect(websiteHost(website)).toBe(host);
  });

  it("lets an item's website without a scheme get its site's rules", () => {
    const generated = new GeneratedCredential("abc^^^DEF&*123xy", "password", at);
    expect(forSiteRules(generated, "chase.com").credential).not.toBe(generated.credential);
  });
});
