// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { allowedParentOrigin, b64Decode, framedOnlyBy, getQsParam } from "./common";
import { buildDataString, parseWebauthnJson } from "./common-webauthn";

// The security key step of signing in, in a frame on the web vault's sign-in
// page (WebAuthnIFrame, libs/common/src/auth/webauthn-iframe.ts). PassBundle:
// it answers only the page that framed it, and only when that page is the web
// vault itself or PassBundle's own extension; for any other page it asks no
// security key and sends nothing (DESIGN.md, "Connector pages"). Upstream's
// mobile and desktop return paths (deep links to upstream's apps) are gone:
// PassBundle's own apps don't use this page.

let parsed = false;
let webauthnJson: any;
let headerText: string = null;
let btnText: string = null;
let btnAwaitingInteractionText: string = null;
let parentOrigin: string = null;
let stopWebAuthn = false;
let sentSuccess = false;
let obj: any = null;

// For accessibility, we do not actually disable the button as it would
// become unfocusable by a screenreader. We just make it look disabled.
const disabledBtnClasses = [
  "tw-bg-secondary-300",
  "tw-border-secondary-300",
  "!tw-text-muted",
  "!tw-cursor-not-allowed",
  "hover:tw-bg-secondary-300",
  "hover:tw-border-secondary-300",
  "hover:!tw-text-muted",
  "hover:tw-no-underline",
];

const enabledBtnClasses = [
  "tw-bg-primary-600",
  "tw-border-primary-600",
  "!tw-text-contrast",
  "hover:tw-bg-primary-700",
  "hover:tw-border-primary-700",
  "hover:!tw-text-contrast",
  "hover:tw-no-underline",
];

document.addEventListener("DOMContentLoaded", () => {
  init();
});

function setDefaultWebAuthnButtonState() {
  if (!btnText) {
    return;
  }

  const button = document.getElementById("webauthn-button");
  button.onclick = executeWebAuthn;

  button.innerText = decodeURI(btnText);

  // reset back to default button state
  button.classList.remove(...disabledBtnClasses);
  button.classList.add(...enabledBtnClasses);
}

function setAwaitingInteractionWebAuthnButtonState() {
  if (!btnAwaitingInteractionText) {
    return;
  }
  const button = document.getElementById("webauthn-button");
  button.innerText = decodeURI(btnAwaitingInteractionText);
  button.onclick = null;

  button.classList.remove(...enabledBtnClasses);
  button.classList.add(...disabledBtnClasses);
}

export function init() {
  // WebAuthnIFrame encodes the parent's address once more inside the query.
  let parentUrl = getQsParam("parent");
  try {
    parentUrl = parentUrl ? decodeURIComponent(parentUrl) : null;
  } catch {
    parentUrl = null;
  }
  parentOrigin = allowedParentOrigin(parentUrl);
  if (!parentOrigin || !framedOnlyBy(parentOrigin)) {
    refuse();
    return;
  }

  start();
  onMessage();
  info("ready");
}

/**
 * Framed by a page it may not answer, or opened on its own: no security key
 * prompt, no message to anyone, and a page that says so.
 */
function refuse() {
  parentOrigin = null;
  stopWebAuthn = true;
  document.body.setAttribute("data-refused", "");
  document.body.textContent = "This page works only inside your vault.";
}

function parseParameters() {
  if (parsed) {
    return;
  }

  const data = getQsParam("data");
  if (!data) {
    error("No data.");
    return;
  }

  webauthnJson = b64Decode(data);
  headerText = getQsParam("headerText");
  btnText = getQsParam("btnText");
  btnAwaitingInteractionText = getQsParam("btnAwaitingInteractionText");

  parsed = true;
}

function start() {
  sentSuccess = false;

  if (!("credentials" in navigator)) {
    error("WebAuthn is not supported in this browser.");
    return;
  }

  parseParameters();

  if (headerText) {
    const header = document.getElementById("webauthn-header");
    if (header) {
      header.innerText = decodeURI(headerText);
    }
  }

  setDefaultWebAuthnButtonState();

  if (!webauthnJson) {
    error("No data.");
    return;
  }

  try {
    obj = parseWebauthnJson(webauthnJson);
    // FIXME: Remove when updating file. Eslint update
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    error("Cannot parse webauthn data.");
    return;
  }

  stopWebAuthn = false;

  if (
    navigator.userAgent.indexOf(" Safari/") !== -1 &&
    navigator.userAgent.indexOf("Chrome") === -1
  ) {
    // Safari blocks non-user initiated WebAuthn requests.
  } else {
    executeWebAuthn();
  }
}

function executeWebAuthn() {
  if (stopWebAuthn) {
    // reset back to default button state
    setDefaultWebAuthnButtonState();
    return;
  }

  setAwaitingInteractionWebAuthnButtonState();
  navigator.credentials.get({ publicKey: obj }).then(success).catch(error);
}

function onMessage() {
  window.addEventListener(
    "message",
    (event) => {
      // Only the page that framed this one, from the origin it was given.
      if (event.source !== window.parent || event.origin !== parentOrigin) {
        return;
      }

      if (event.data === "stop") {
        setDefaultWebAuthnButtonState();
        stopWebAuthn = true;
      } else if (event.data === "start" && stopWebAuthn) {
        start();
      }
    },
    false,
  );
}

// Every message goes to the parent's own origin, never "*": if the frame's
// parent isn't that origin anymore, the browser drops it.
function send(message: string) {
  if (!parentOrigin) {
    return;
  }
  window.parent.postMessage(message, parentOrigin);
}

function error(message: string) {
  send("error|" + message);
  setDefaultWebAuthnButtonState();
}

function success(assertedCredential: PublicKeyCredential) {
  if (sentSuccess || !parentOrigin) {
    return;
  }

  send("success|" + buildDataString(assertedCredential));
  sentSuccess = true;
}

function info(message: string) {
  send("info|" + message);
}
