import { ErrorResponse } from "./error.response";

// Keykeeper: the reason a server gives for turning down a new account at the
// first sign-up step (DESIGN.md, "New accounts on a closed server").
describe("ErrorResponse, a refused new account", () => {
  const body = (more: Record<string, unknown> = {}) => ({
    message: "This server isn't taking new accounts.",
    validationErrors: { "": ["This server isn't taking new accounts."] },
    object: "error",
    ...more,
  });

  it.each(["closed", "address"] as const)("reads the server's reason %p", (reason) => {
    const error = new ErrorResponse(body({ keykeeperNewAccounts: reason }), 400);

    expect(error.keykeeperNewAccounts).toBe(reason);
    expect(error.message).toBe("This server isn't taking new accounts.");
    expect(error.statusCode).toBe(400);
  });

  it("reads it however the server spells the first letter", () => {
    expect(new ErrorResponse({ KeykeeperNewAccounts: "address" }, 400).keykeeperNewAccounts).toBe(
      "address",
    );
  });

  it("has none from a server that doesn't say", () => {
    const error = new ErrorResponse(body(), 400);

    expect(error.keykeeperNewAccounts).toBeUndefined();
    expect(error.message).toBe("This server isn't taking new accounts.");
  });

  it.each([["later"], [true], [1], [null], [{ closed: true }]])(
    "has none for a reason it doesn't know (%p)",
    (reason) => {
      expect(
        new ErrorResponse(body({ keykeeperNewAccounts: reason }), 400).keykeeperNewAccounts,
      ).toBeUndefined();
    },
  );

  it("has none when there's no answer to read", () => {
    expect(new ErrorResponse(null, 500).keykeeperNewAccounts).toBeUndefined();
    expect(new ErrorResponse("Bad Gateway", 502).keykeeperNewAccounts).toBeUndefined();
  });
});
