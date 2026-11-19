// Keykeeper: the frames a card fills (DESIGN.md, "Addresses and cards",
// "Frames", and "Decisions for the owner" 6, in the meta repo). Upstream
// fills a card into every frame of the tab with visible fields, from any site;
// only logins get its check against other sites' frames. A card now fills
// only:
//
// - the page itself, and frames from the page's own site (the same
//   registrable domain, so checkout.shop.example and pay.shop.example);
// - the frame the person started the fill from (the field whose menu they
//   chose the card in, or where they opened the context menu);
// - frames of the payment services below, whose card fields are frames of
//   their own on a shop's checkout.
//
// Any other frame gets nothing: its fill is refused before any value leaves
// the extension. Called from upstream's doAutoFill in a `// Keykeeper:` block.
//
// The payment services and their frames' hosts, from their own public docs
// on their hosted card fields (each one's Content Security Policy guide):
//
// - Stripe (Elements, and Checkout embedded in a page): js.stripe.com and
//   hosts under it, and checkout.stripe.com.
// - Braintree (Hosted Fields): assets.braintreegateway.com.
// - Adyen (Web Components and Drop-in): the checkoutshopper hosts for each
//   region and its test environment, such as checkoutshopper-live.adyen.com
//   and checkoutshopper-live-us.cdn.adyen.com.
// - Square (Web Payments SDK): web.squarecdn.com and sandbox.web.squarecdn.com.

import { Utils } from "@bitwarden/common/platform/misc/utils";

/** Hosts of payment services' card fields. */
const PAYMENT_HOSTS = new Set([
  "js.stripe.com",
  "checkout.stripe.com",
  "assets.braintreegateway.com",
  "web.squarecdn.com",
  "sandbox.web.squarecdn.com",
]);

/** Hosts under these are payment services' card fields too. */
const PAYMENT_HOSTS_UNDER = [".js.stripe.com"];

/** Adyen's checkoutshopper hosts, for each region and the test environment. */
const ADYEN_HOST = /^checkoutshopper-[a-z0-9-]+(\.cdn)?\.adyen\.com$/;

/** Whether a frame's address is a payment service's card fields, over HTTPS. */
export function isPaymentServiceFrame(url: string | null | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return (
    PAYMENT_HOSTS.has(host) ||
    PAYMENT_HOSTS_UNDER.some((suffix) => host.endsWith(suffix)) ||
    ADYEN_HOST.test(host)
  );
}

/** Whether a frame is from the page's own site: the same registrable domain as the tab's. */
export function isPagesOwnSite(
  frameUrl: string | null | undefined,
  tabUrl: string | null | undefined,
): boolean {
  const frame = Utils.getDomain(frameUrl);
  const page = Utils.getDomain(tabUrl);
  return frame != null && page != null && frame === page;
}

/**
 * Whether a card may fill a frame of the tab: the page itself (frame 0), a
 * frame from the page's own site, the frame the person started the fill from,
 * or a payment service's frame.
 */
export function cardMayFillFrame(frame: {
  frameId: number;
  frameUrl: string | null | undefined;
  tabUrl: string | null | undefined;
  startedInFrameId?: number | null;
}): boolean {
  return (
    frame.frameId === 0 ||
    (frame.startedInFrameId != null && frame.frameId === frame.startedInFrameId) ||
    isPagesOwnSite(frame.frameUrl, frame.tabUrl) ||
    isPaymentServiceFrame(frame.frameUrl)
  );
}
