import { ErrorResponse } from "../../models/response/error.response";

import {
  isTimedOut,
  isUnreachable,
  PLAIN_ERRORS,
  plainErrorMessage,
  plainSentence,
} from "./plain-errors";

/** An error as Vaultwarden sends it, as upstream's ApiService turns it into an ErrorResponse. */
const server = (status: number, message: string) =>
  new ErrorResponse(
    {
      message,
      validationErrors: { "": [message] },
      ErrorModel: { Message: message, Object: "error" },
      object: "error",
    },
    status,
  );

describe("plainErrorMessage", () => {
  describe("when the request got no answer", () => {
    it.each([
      ["Chrome", "Failed to fetch"],
      ["Firefox", "NetworkError when attempting to fetch resource."],
      ["Safari", "Load failed"],
    ])("says the server couldn't be reached (%s's words)", (_, message) => {
      expect(plainErrorMessage(new TypeError(message))).toBe(PLAIN_ERRORS.offline);
      expect(isUnreachable(new TypeError(message))).toBe(true);
    });

    it("says it took too long when the page stopped waiting", () => {
      const aborted = new DOMException("The operation was aborted.", "AbortError");
      const timedOut = new DOMException("signal timed out", "TimeoutError");
      expect(plainErrorMessage(aborted)).toBe(PLAIN_ERRORS.slow);
      expect(plainErrorMessage(timedOut)).toBe(PLAIN_ERRORS.slow);
      expect(isTimedOut(aborted)).toBe(true);
    });
  });

  describe("when the server answered", () => {
    it("shows the server's own plain sentence", () => {
      expect(
        plainErrorMessage(server(400, "You don't have permission to clear this item's history")),
      ).toBe("You don't have permission to clear this item's history");
    });

    it("never shows the time and address upstream adds to a wrong code", () => {
      const message = plainErrorMessage(
        server(400, "Invalid TOTP code! Server time: 2026-11-07 15:04:05 UTC IP: 203.0.113.9"),
      );
      expect(message).toBe(
        "That code didn't work. Enter the newest code your authenticator app shows. If it still doesn't work, check that this device's clock sets itself automatically.",
      );
      expect(message).not.toMatch(/203\.0\.113|Server time|UTC/);
    });

    it.each([
      ["TOTP code is not a number", "Enter the 6-digit code your authenticator app shows."],
      ["Invalid TOTP secret", "That setup key didn't work. Go back and start again."],
      ["Invalid totp secret", "That setup key didn't work. Go back and start again."],
      ["Invalid key length", "That setup key didn't work. Go back and start again."],
      ["Invalid password", "That master password isn't right. Try again."],
      ["No validation provided", "Enter your master password first."],
      [
        "Configured `DOMAIN` is not compatible with Webauthn",
        "This server can't set up security keys at its address. Choose another way, and tell whoever runs the server.",
      ],
      [
        "Webauthn data not found!",
        "Your security key or passkey couldn't be set up. Try again, or choose another way.",
      ],
      [
        "Due to an Enterprise Policy, you are restricted from saving items to your personal vault.",
        "Your organization keeps everyone's items in its shared folders, so this can't go in Personal. Choose one of its shared folders instead.",
      ],
      [
        "The client copy of this cipher is out of date. Resync the client and try again.",
        "This item changed since you opened it. Close it, open it again, and try once more.",
      ],
      ["Item not found", PLAIN_ERRORS.gone],
      ["Cipher doesn't exist", PLAIN_ERRORS.gone],
    ])("puts upstream's %p in plain words", (raw, plain) => {
      expect(plainErrorMessage(server(400, raw))).toBe(plain);
    });

    it("gives ours for an answer that would show the server's insides", () => {
      for (const raw of [
        "UNIQUE constraint failed: ciphers.uuid",
        "Error running query: diesel error",
        "Couldn't connect from 10.0.0.12",
        "<!DOCTYPE html><html><body>Bad gateway</body></html>",
        '{"error":"something"}',
        "thread 'rocket-worker' panicked at src/api.rs:12",
        "x".repeat(500),
      ]) {
        expect(plainErrorMessage(server(400, raw))).toBe(PLAIN_ERRORS.unknown);
      }
    });

    it("gives ours for the server's own problems, whatever came with them", () => {
      // A proxy's 502 is a web page, so upstream's ErrorResponse has no message.
      expect(plainErrorMessage(new ErrorResponse(null, 502))).toBe(PLAIN_ERRORS.serverProblem);
      // A text/plain answer becomes its message.
      expect(plainErrorMessage(new ErrorResponse({ Message: "Bad Gateway" }, 502))).toBe(
        PLAIN_ERRORS.serverProblem,
      );
      expect(plainErrorMessage(server(500, "Database pool timed out"))).toBe(
        PLAIN_ERRORS.serverProblem,
      );
      expect(plainErrorMessage(new ErrorResponse(null, 504))).toBe(PLAIN_ERRORS.slow);
    });

    it("says to wait after too many tries", () => {
      expect(plainErrorMessage(new ErrorResponse(null, 429))).toBe(PLAIN_ERRORS.tooMany);
      expect(plainErrorMessage(server(400, "Rate limit exceeded. Try again later."))).toBe(
        PLAIN_ERRORS.tooMany,
      );
    });

    it("gives ours, by status, when the answer has no sentence", () => {
      expect(plainErrorMessage(new ErrorResponse(null, 400))).toBe(PLAIN_ERRORS.unknown);
      expect(plainErrorMessage(new ErrorResponse(null, 401))).toBe(PLAIN_ERRORS.signedOut);
      expect(plainErrorMessage(new ErrorResponse(null, 403))).toBe(PLAIN_ERRORS.notAllowed);
      expect(plainErrorMessage(new ErrorResponse(null, 404))).toBe(PLAIN_ERRORS.gone);
      expect(plainErrorMessage(new ErrorResponse({ message: "" }, 400))).toBe(PLAIN_ERRORS.unknown);
    });

    it("takes the first validation error, as upstream's pages do", () => {
      const e = new ErrorResponse(
        {
          message: "The model state is invalid.",
          validationErrors: { Name: ["Name is too long."] },
        },
        400,
      );
      expect(plainErrorMessage(e)).toBe("Name is too long.");
    });
  });

  describe("when our own code refused", () => {
    it("shows its sentence, without a prefix", () => {
      expect(plainErrorMessage(new Error("Choose at least one client."))).toBe(
        "Choose at least one client.",
      );
      expect(plainErrorMessage("Error: Choose at least one client.")).toBe(
        "Choose at least one client.",
      );
    });

    it("shows a custom error's sentence", () => {
      class Refused extends Error {}
      expect(plainErrorMessage(new Refused("This account already has five security keys."))).toBe(
        "This account already has five security keys.",
      );
    });

    it("never shows JavaScript's own errors", () => {
      expect(plainErrorMessage(new TypeError("Cannot read properties of undefined"))).toBe(
        PLAIN_ERRORS.unknown,
      );
      expect(plainErrorMessage(new SyntaxError("Unexpected token '<'"))).toBe(PLAIN_ERRORS.unknown);
      expect(plainErrorMessage(new RangeError("Invalid array length"))).toBe(PLAIN_ERRORS.unknown);
    });

    it("says the browser stopped it, for a security key cancelled or timed out", () => {
      expect(
        plainErrorMessage(new DOMException("The operation either timed out", "NotAllowedError")),
      ).toBe(PLAIN_ERRORS.browserStopped);
    });

    it("has something to say for anything else", () => {
      expect(plainErrorMessage(null)).toBe(PLAIN_ERRORS.unknown);
      expect(plainErrorMessage(undefined)).toBe(PLAIN_ERRORS.unknown);
      expect(plainErrorMessage({ what: "this" })).toBe(PLAIN_ERRORS.unknown);
      expect(plainErrorMessage(new Error(""))).toBe(PLAIN_ERRORS.unknown);
    });
  });

  it("every sentence of ours says what to do next", () => {
    for (const sentence of Object.values(PLAIN_ERRORS)) {
      expect(sentence).toMatch(
        /\b(?:try|check|wait|sign in|ask|reload|choose|enter|go back|close)\b/i,
      );
      expect(sentence).not.toMatch(/—/);
    }
  });
});

describe("plainSentence", () => {
  it("keeps a plain sentence as it is", () => {
    expect(plainSentence("Choose at least one client.")).toBe("Choose at least one client.");
  });

  it("gives what it's told to when the sentence can't be shown", () => {
    expect(plainSentence("", "Couldn't send it.")).toBe("Couldn't send it.");
    expect(plainSentence("Error at 192.168.1.4", "Couldn't send it.")).toBe("Couldn't send it.");
  });
});
