// Keykeeper: "Open and fill" (DESIGN.md, "Open and fill"). The open button on
// a login opens its website in a new tab, and the extension fills that tab,
// once. This is the part the popup's lists, the item view, and the extension's
// background share: which of a login's websites open that way, and the
// address each one opens.

import { UriMatchStrategy, UriMatchStrategySetting } from "../../models/domain/domain-service";
import { LoginUriView } from "../models/view/login-uri.view";

/** A login's website, from a full item or a list's summary of one. */
export type OpenAndFillWebsite = {
  uri?: string | null;
  /** How it's matched: upstream's UriMatchStrategy, or the SDK's equal UriMatchType. */
  match?: number | null;
};

/**
 * The address "Open and fill" opens for one of a login's websites, or null
 * when the website only opens: one that isn't a web address (ssh://, say), a
 * pattern, or one set to never fill. A website saved without a scheme opens
 * over https (upstream's plain open uses http), so the page it fills is never
 * an http copy of the site unless the website itself says http.
 */
export function openAndFillUrl(website: OpenAndFillWebsite | null | undefined): string | null {
  if (website?.uri == null || website.match === UriMatchStrategy.Never) {
    return null;
  }
  const view = new LoginUriView();
  view.uri = website.uri;
  view.match = (website.match ?? undefined) as UriMatchStrategySetting | undefined;
  if (!view.canLaunch || view.launchUri == null) {
    return null;
  }
  const address = website.uri.includes("://") ? view.launchUri : `https://${website.uri}`;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

/** The first of a login's websites that opens and fills, or null if none does. */
export function firstOpenAndFillUrl(
  websites: OpenAndFillWebsite[] | null | undefined,
): string | null {
  for (const website of websites ?? []) {
    const url = openAndFillUrl(website);
    if (url != null) {
      return url;
    }
  }
  return null;
}
