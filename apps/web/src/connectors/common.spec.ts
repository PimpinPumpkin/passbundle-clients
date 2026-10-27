jest.mock("./keykeeper-origins", () => ({
  EXTENSION_ORIGINS: ["chrome-extension://cenoidjoogmoieibpcokkafjnaabhokg"],
}));

import {
  allowedParentOrigin,
  b64Decode,
  framedOnlyBy,
  getQsParam,
  isAllowedOrigin,
} from "./common";

const vault = "https://vault.example.com";
const extension = "chrome-extension://cenoidjoogmoieibpcokkafjnaabhokg";

function setLocation(href: string, ancestorOrigins?: string[]) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    value: { href, hostname: url.hostname, origin: url.origin, ancestorOrigins },
    writable: true,
    configurable: true,
  });
}

function setParent(parent: Window | object) {
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
}

function setReferrer(referrer: string) {
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

describe("common connector utilities", () => {
  const ownParent = window.parent;
  afterEach(() => setParent(ownParent));

  describe("getQsParam", () => {
    it("returns the value for an existing query parameter", () => {
      setLocation("https://example.com?foo=bar");
      expect(getQsParam("foo")).toBe("bar");
    });

    it("returns null when the parameter does not exist", () => {
      setLocation("https://example.com?foo=bar");
      expect(getQsParam("missing")).toBeNull();
    });

    it("decodes URI-encoded values", () => {
      setLocation("https://example.com?msg=hello%20world");
      expect(getQsParam("msg")).toBe("hello world");
    });

    it("returns empty string for a parameter with no value", () => {
      setLocation("https://example.com?flag&other=1");
      expect(getQsParam("flag")).toBe("");
    });
  });

  describe("b64Decode", () => {
    it("decodes a base64 string", () => {
      const encoded = btoa("hello world");
      expect(b64Decode(encoded)).toBe("hello world");
    });

    it("handles spaceAsPlus replacement", () => {
      const original = btoa("test");
      const withSpaces = original.replace(/\+/g, " ");
      expect(b64Decode(withSpaces, true)).toBe("test");
    });
  });

  describe("isAllowedOrigin", () => {
    beforeEach(() => setLocation(`${vault}/webauthn-connector.html`));

    it("allows the page's own origin and PassBundle's extension", () => {
      expect(isAllowedOrigin(vault)).toBe(true);
      expect(isAllowedOrigin(extension)).toBe(true);
    });

    it.each([
      ["another site", "https://attacker.example.net"],
      ["a lookalike of the vault", "https://vault.example.com.attacker.example.net"],
      ["the vault on another port", "https://vault.example.com:8443"],
      ["the vault over http", "http://vault.example.com"],
      ["another extension", "chrome-extension://nngceckbapebfimnlniiiahkandclblb"],
      ["any Firefox extension", "moz-extension://4b1e6a52-0000-4000-8000-000000000000"],
      ["an opaque origin", "null"],
      ["nothing", ""],
    ])("refuses %s", (_, origin) => {
      expect(isAllowedOrigin(origin)).toBe(false);
    });
  });

  describe("allowedParentOrigin", () => {
    beforeEach(() => setLocation(`${vault}/webauthn-connector.html`));

    it("gives the origin of a parent on the web vault itself", () => {
      expect(allowedParentOrigin(`${vault}/#/2fa`)).toBe(vault);
    });

    it("gives the origin of a parent in PassBundle's extension", () => {
      expect(allowedParentOrigin(`${extension}/popup/index.html#/2fa`)).toBe(extension);
    });

    it.each([
      ["another site", "https://attacker.example.net/phish.html"],
      ["a file", "file:///Users/someone/phish.html"],
      ["upstream's extension", "chrome-extension://nngceckbapebfimnlniiiahkandclblb/popup.html"],
      ["a data URL", "data:text/html,<p>hi</p>"],
      ["no URL at all", "not a url"],
      ["nothing", null],
    ])("gives nothing for %s", (_, parent) => {
      expect(allowedParentOrigin(parent)).toBeNull();
    });
  });

  describe("framedOnlyBy", () => {
    const framedBy = { postMessage: jest.fn() };

    it("is false for a page that isn't framed", () => {
      setLocation(`${vault}/webauthn-connector.html`, []);
      setParent(window);
      expect(framedOnlyBy(vault)).toBe(false);
    });

    it("is true when the browser lists only allowed pages around it, nearest first", () => {
      setParent(framedBy);
      setLocation(`${vault}/webauthn-connector.html`, [vault]);
      expect(framedOnlyBy(vault)).toBe(true);
      setLocation(`${vault}/webauthn-connector.html`, [extension]);
      expect(framedOnlyBy(extension)).toBe(true);
    });

    it("is false when the nearest page isn't the parent it was given", () => {
      setParent(framedBy);
      setLocation(`${vault}/webauthn-connector.html`, ["https://attacker.example.net"]);
      expect(framedOnlyBy(vault)).toBe(false);
    });

    it("is false when any page further out is another site", () => {
      setParent(framedBy);
      setLocation(`${vault}/webauthn-connector.html`, [vault, "https://attacker.example.net"]);
      expect(framedOnlyBy(vault)).toBe(false);
    });

    describe("where the browser lists no ancestors (Firefox)", () => {
      beforeEach(() => {
        setParent(framedBy);
        setLocation(`${vault}/webauthn-connector.html`);
      });
      afterEach(() => setReferrer(""));

      it("is true when the page that loaded the frame is on the parent's origin", () => {
        setReferrer(`${vault}/#/2fa`);
        expect(framedOnlyBy(vault)).toBe(true);
      });

      it("is false when that page is another site", () => {
        setReferrer("https://attacker.example.net/phish.html");
        expect(framedOnlyBy(vault)).toBe(false);
      });

      it("is false when the referrer was withheld", () => {
        setReferrer("");
        expect(framedOnlyBy(vault)).toBe(false);
      });
    });
  });
});
