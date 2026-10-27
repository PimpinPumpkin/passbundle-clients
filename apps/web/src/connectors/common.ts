import { EXTENSION_ORIGINS } from "./keykeeper-origins";

/**
 * PassBundle: the only origins a connector page answers. A connector is
 * framed or opened by the web vault itself, or by PassBundle's own browser
 * extension, and it sends what it learns (a security key's signature, for
 * one) only to them. Upstream trusted any `parent` named in the address on a
 * self-hosted server, so a page anywhere could frame a connector and receive
 * a security key's answer (DESIGN.md, "Connector pages").
 */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin || origin === "null") {
    return false;
  }
  return origin === window.location.origin || EXTENSION_ORIGINS.includes(origin);
}

/**
 * The origin of the `parent` a connector was given, when it is one the
 * connector may answer; otherwise null, and the connector answers no one.
 */
export function allowedParentOrigin(parentUrl: string | null): string | null {
  const origin = originOf(parentUrl);
  return isAllowedOrigin(origin) ? origin : null;
}

/** The origin of an address, or null for none or one that isn't a URL. */
function originOf(address: string | null | undefined): string | null {
  if (!address) {
    return null;
  }
  try {
    const url = new URL(address);
    // Extension addresses aren't "special" URLs, so URL.origin can be "null"
    // for them outside Chromium; their origin is the scheme and the ID.
    return url.protocol === "chrome-extension:" ? `chrome-extension://${url.host}` : url.origin;
  } catch {
    return null;
  }
}

/**
 * Whether every page around this one is one a connector may answer, where
 * the browser says (Chromium and Safari list them in
 * location.ancestorOrigins). The nearest must be the expected parent.
 * Firefox doesn't list them: there the page that loaded this frame (its
 * referrer) must be on the parent's origin, and a frame with no referrer
 * gets nothing. postMessage's target origin and the server's
 * frame-ancestors guard too.
 */
export function framedOnlyBy(parentOrigin: string): boolean {
  if (window.parent === window) {
    return false;
  }
  const ancestors = window.location.ancestorOrigins;
  if (ancestors == null) {
    return originOf(document.referrer) === parentOrigin;
  }
  if (ancestors.length === 0 || ancestors[0] !== parentOrigin) {
    return false;
  }
  return Array.from(ancestors).every((origin) => isAllowedOrigin(origin));
}

export function getQsParam(name: string) {
  const url = window.location.href;
  // eslint-disable-next-line
  name = name.replace(/[\[\]]/g, "\\$&");
  const regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)");
  const results = regex.exec(url);

  if (!results) {
    return null;
  }
  if (!results[2]) {
    return "";
  }

  return decodeURIComponent(results[2].replace(/\+/g, " "));
}

export function b64Decode(str: string, spaceAsPlus = false) {
  if (spaceAsPlus) {
    str = str.replace(/ /g, "+");
  }

  return decodeURIComponent(
    Array.prototype.map
      .call(atob(str), (c: string) => {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(""),
  );
}
