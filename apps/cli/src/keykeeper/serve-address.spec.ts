// Keykeeper: see serve-address.ts and command-line.ts.
import { passwordOnCommandLine, sessionOnCommandLine } from "./command-line";
import { isLoopback, serveAddressRefusal } from "./serve-address";

describe("where serve listens", () => {
  it.each([
    undefined,
    "",
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "[::1]",
    "unix:///run/pb.sock",
  ])("listens at %p without asking", (hostname) => {
    expect(serveAddressRefusal(hostname, false)).toBeNull();
  });

  it.each([
    "all",
    "0.0.0.0",
    "::",
    "192.168.1.10",
    "bwapi.mydomain.com",
    "fd+listening://3",
    "128.0.0.1",
    "localhost.example.com",
  ])("refuses %p unless told it's on purpose", (hostname) => {
    expect(serveAddressRefusal(hostname, false)).toContain(`Not listening on ${hostname}`);
    expect(serveAddressRefusal(hostname, true)).toBeNull();
  });

  it("knows loopback addresses", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("10.0.0.1")).toBe(false);
  });
});

describe("secrets on the command line", () => {
  it("says what to use instead", () => {
    expect(
      sessionOnCommandLine({
        name: "P",
        command: "p",
        envPrefix: "PASSBUNDLE_",
        version: "",
        releases: "",
      }),
    ).toContain("Set PASSBUNDLE_SESSION instead");
    expect(passwordOnCommandLine()).toContain("--passwordenv or --passwordfile");
  });
});
