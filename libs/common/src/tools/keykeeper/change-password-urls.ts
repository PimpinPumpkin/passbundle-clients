// Keykeeper: sites' own change-password pages, from Apple's published list
// (site-change-password-urls.data.ts), looked up on the device, so "Change
// password" opens the right page without asking any server. See DESIGN.md,
// "Health (better than Watchtower)".

import { SITE_CHANGE_PASSWORD_URLS } from "./site-change-password-urls.data";

/** The change-password page for a host (any port is ignored), from the site's own entry or its parent domain's. */
export function changePasswordUrlFor(
  host: string | null | undefined,
  table: Readonly<Record<string, string>> = SITE_CHANGE_PASSWORD_URLS,
): string | null {
  const labels = (host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const url = table[labels.slice(i).join(".")];
    if (url != null) {
      return url;
    }
  }
  return null;
}
