/**
 * The security key connector (webauthn.ts), as the web vault frames it
 * (WebAuthnIFrame). PassBundle: it answers only the page that framed it, when
 * that page is the web vault itself or PassBundle's own extension; any other
 * page gets no security key prompt and no message (DESIGN.md, "Connector
 * pages").
 *
 * Each test imports a fresh module (jest.isolateModules), since the
 * connector keeps its state in module variables.
 */
jest.mock("./keykeeper-origins", () => ({
  EXTENSION_ORIGINS: ["chrome-extension://cenoidjoogmoieibpcokkafjnaabhokg"],
}));

const vault = "https://vault.example.com";
const extension = "chrome-extension://cenoidjoogmoieibpcokkafjnaabhokg";
const attacker = "https://attacker.example.net";

/** The address WebAuthnIFrame gives the frame (version 1 parameters). */
function connectorUrl(parent: string) {
  const options = JSON.stringify({ challenge: "dGVzdC1jaGFsbGVuZ2U", allowCredentials: [] });
  const params = new URLSearchParams({
    data: btoa(options),
    parent: encodeURIComponent(parent),
    btnText: encodeURIComponent("Read security key"),
    btnAwaitingInteractionText: encodeURIComponent("Waiting for security key"),
    v: "1",
  });
  return `${vault}/webauthn-connector.html?${params}`;
}

function mockPublicKeyCredential(): PublicKeyCredential {
  const buffer = new ArrayBuffer(8);
  return {
    id: "test-credential-id",
    rawId: buffer,
    type: "public-key",
    getClientExtensionResults: () => ({}),
    response: {
      authenticatorData: buffer,
      clientDataJSON: buffer,
      signature: buffer,
    },
    authenticatorAttachment: null,
  } as unknown as PublicKeyCredential;
}

describe("webauthn connector", () => {
  const ownParent = window.parent;
  let parent: { postMessage: jest.Mock };
  let get: jest.Mock;
  // Each test's module listens on the same window: forget its listeners
  // afterwards, so the next test's messages reach only its own.
  let listeners: [string, EventListenerOrEventListenerObject][];

  beforeEach(() => {
    listeners = [];
    const add = window.addEventListener.bind(window);
    jest.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      listeners.push([type, listener]);
      add(type, listener, options);
    });
    document.body.innerHTML = `<button id="webauthn-button"></button>`;
    parent = { postMessage: jest.fn() };
    get = jest.fn().mockResolvedValue(mockPublicKeyCredential());
    Object.defineProperty(navigator, "credentials", { value: { get }, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
    for (const [type, listener] of listeners) {
      window.removeEventListener(type, listener);
    }
    Object.defineProperty(window, "parent", { value: ownParent, configurable: true });
    document.body.innerHTML = "";
    jest.restoreAllMocks();
    jest.resetModules();
  });

  /**
   * Opens the connector with this parent, in a frame whose surrounding pages
   * the browser lists as `ancestors` (undefined: a browser that doesn't list
   * them, like Firefox, where the page that loaded the frame is `referrer`).
   * `framed: false` opens it on its own.
   */
  async function open(
    parentUrl: string,
    {
      ancestors,
      referrer = "",
      framed = true,
    }: { ancestors?: string[]; referrer?: string; framed?: boolean } = {},
  ) {
    const href = connectorUrl(parentUrl);
    Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
    Object.defineProperty(window, "location", {
      value: { href, hostname: new URL(vault).hostname, origin: vault, ancestorOrigins: ancestors },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "parent", {
      value: framed ? parent : window,
      configurable: true,
    });
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("./webauthn").init();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const sent = () => parent.postMessage.mock.calls.map(([message, origin]) => [message, origin]);

  describe("answers", () => {
    it("the web vault that framed it, at the vault's own origin", async () => {
      await open(`${vault}/#/2fa`, { ancestors: [vault] });

      expect(get).toHaveBeenCalledTimes(1);
      expect(sent()).toEqual([
        ["info|ready", vault],
        [expect.stringMatching(/^success\|\{/), vault],
      ]);
    });

    it("PassBundle's own extension that framed it, at the extension's origin", async () => {
      await open(`${extension}/popup/index.html#/2fa`, { ancestors: [extension] });

      expect(get).toHaveBeenCalledTimes(1);
      expect(sent()).toEqual([
        ["info|ready", extension],
        [expect.stringMatching(/^success\|/), extension],
      ]);
    });

    it("the vault in a browser that doesn't list ancestors, only at the vault's origin", async () => {
      await open(`${vault}/#/2fa`, { referrer: `${vault}/#/2fa` });

      expect(sent().map(([, origin]) => origin)).toEqual([vault, vault]);
    });

    it("a failed attempt to the same origin only", async () => {
      get.mockRejectedValue(new Error("user cancelled"));
      await open(`${vault}/#/2fa`, { ancestors: [vault] });

      expect(sent()).toEqual([
        ["info|ready", vault],
        [expect.stringMatching(/^error\|/), vault],
      ]);
    });
  });

  describe("refuses, asking no security key and sending nothing,", () => {
    it.each([
      ["another site that names itself as the parent", attacker, [attacker]],
      ["another site that names the vault as the parent", vault, [attacker]],
      ["the vault, framed in turn by another site", vault, [vault, attacker]],
      [
        "upstream's extension",
        "chrome-extension://nngceckbapebfimnlniiiahkandclblb/popup.html",
        ["chrome-extension://nngceckbapebfimnlniiiahkandclblb"],
      ],
      ["a file", "file:///Users/someone/phish.html", ["null"]],
    ])("for %s", async (_, parentUrl, ancestors) => {
      await open(parentUrl, { ancestors });

      expect(get).not.toHaveBeenCalled();
      expect(parent.postMessage).not.toHaveBeenCalled();
      expect(document.body.hasAttribute("data-refused")).toBe(true);
      expect(document.getElementById("webauthn-button")).toBeNull();
    });

    it.each([
      [
        "another site naming itself as the parent",
        `${attacker}/phish.html`,
        `${attacker}/phish.html`,
      ],
      ["another site naming the vault as the parent", `${vault}/#/2fa`, `${attacker}/phish.html`],
      ["a frame whose referrer was withheld", `${vault}/#/2fa`, ""],
    ])("in a browser that doesn't list ancestors, for %s", async (_, parentUrl, referrer) => {
      await open(parentUrl, { referrer });

      expect(get).not.toHaveBeenCalled();
      expect(parent.postMessage).not.toHaveBeenCalled();
      expect(document.body.hasAttribute("data-refused")).toBe(true);
    });

    it("when opened on its own, not in a frame", async () => {
      await open(`${vault}/#/2fa`, { ancestors: [], framed: false });

      expect(get).not.toHaveBeenCalled();
      expect(document.body.hasAttribute("data-refused")).toBe(true);
    });

    it("when it has no parent", async () => {
      await open("", { ancestors: [vault] });

      expect(get).not.toHaveBeenCalled();
      expect(parent.postMessage).not.toHaveBeenCalled();
    });
  });

  describe("takes stop and start", () => {
    it("only from the page that framed it, at its origin", async () => {
      get.mockReturnValue(new Promise(() => {}));
      await open(`${vault}/#/2fa`, { ancestors: [vault] });
      expect(get).toHaveBeenCalledTimes(1);

      // Another page's stop is ignored, so a later start does nothing either.
      window.dispatchEvent(
        new MessageEvent("message", { data: "stop", origin: attacker, source: parent as any }),
      );
      window.dispatchEvent(new MessageEvent("message", { data: "stop", origin: vault }));
      window.dispatchEvent(
        new MessageEvent("message", { data: "start", origin: vault, source: parent as any }),
      );
      expect(get).toHaveBeenCalledTimes(1);

      window.dispatchEvent(
        new MessageEvent("message", { data: "stop", origin: vault, source: parent as any }),
      );
      window.dispatchEvent(
        new MessageEvent("message", { data: "start", origin: vault, source: parent as any }),
      );
      expect(get).toHaveBeenCalledTimes(2);
    });
  });
});
