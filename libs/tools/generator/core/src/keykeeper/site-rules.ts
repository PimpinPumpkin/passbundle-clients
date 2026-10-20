import { passwordForSite } from "@bitwarden/common/tools/keykeeper/password-rules";

import { GeneratedCredential } from "../types";

/** The host of a website, given as a page's address or an item's website, with or without its scheme. */
export function websiteHost(website: string | null | undefined): string {
  const value = (website ?? "").trim();
  if (value === "") {
    return "";
  }
  // An item's website can be a bare hostname; anything with a scheme is taken as it is.
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host.toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Keykeeper: a generated password for a website, remade to the site's own
 * password rules when it breaks them, so the site doesn't reject it. Anything
 * that isn't a password, or a site without rules, passes through unchanged.
 * See DESIGN.md, "Health (better than Watchtower)".
 */
export function forSiteRules(
  generated: GeneratedCredential,
  website: string | null | undefined,
): GeneratedCredential {
  if (generated.category !== "password") {
    return generated;
  }
  const password = passwordForSite(generated.credential, websiteHost(website));
  return password === generated.credential
    ? generated
    : new GeneratedCredential(
        password,
        generated.category,
        generated.generationDate,
        generated.source,
        generated.website,
      );
}
