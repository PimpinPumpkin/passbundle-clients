import { passwordForSite } from "@bitwarden/common/tools/keykeeper/password-rules";
import { GeneratedCredential } from "@bitwarden/generator-core";

import { hostOf } from "./fill-rules";

/**
 * Keykeeper: a generated password for a page, remade to the site's own
 * password rules when it breaks them, so the site doesn't reject it. Anything
 * that isn't a password, or a page without rules, passes through unchanged.
 * See DESIGN.md, "Health (better than Watchtower)".
 */
export function forSiteRules(
  generated: GeneratedCredential,
  pageUrl: string | null | undefined,
): GeneratedCredential {
  if (generated.category !== "password") {
    return generated;
  }
  const password = passwordForSite(generated.credential, hostOf(pageUrl));
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
