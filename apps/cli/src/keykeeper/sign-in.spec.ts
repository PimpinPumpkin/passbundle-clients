// Keykeeper: see sign-in.ts and version.ts.
import { CliBrand } from "./brand";
import { ssoPromptMessage, ssoRequiredRefusal } from "./sign-in";
import { cliVersion, updateMessage } from "./version";

describe("ssoRequiredRefusal", () => {
  it("sends someone not linked yet to the web vault to link first", () => {
    const refusal = ssoRequiredRefusal(
      { ssoOrganizationIdentifier: "contoso", keykeeperSsoLinkSession: "link-token" },
      true,
    );
    expect(refusal).toContain("isn't linked to it yet");
    expect(refusal).toContain("web vault");
    expect(refusal).toContain("login --sso contoso`.");
  });

  it("says how to sign in when the tool may not open a browser", () => {
    const refusal = ssoRequiredRefusal({ ssoOrganizationIdentifier: "contoso" }, false);
    expect(refusal).toContain("login --sso contoso`");
    expect(refusal).toContain("login --apikey`");
  });

  it("lets the tool open the browser otherwise", () => {
    expect(ssoRequiredRefusal({ ssoOrganizationIdentifier: "contoso" }, true)).toBeNull();
  });

  it("shows the address it opens", () => {
    expect(ssoPromptMessage("https://vault.example.test/#/sso?clientId=cli")).toContain(
      "https://vault.example.test/#/sso?clientId=cli",
    );
  });
});

describe("the tool's version", () => {
  const brand: CliBrand = {
    name: "PassBundle",
    command: "passbundle",
    envPrefix: "PASSBUNDLE_",
    version: "0.1.7",
    releases: "https://github.com/example/releases",
  };

  it("is its own when it has one, and the app's otherwise", () => {
    expect(cliVersion("2026.8.0", brand)).toBe("0.1.7");
    expect(cliVersion("2026.8.0", { ...brand, version: "" })).toBe("2026.8.0");
  });

  it("says where updates are, since it doesn't update itself", () => {
    expect(updateMessage("0.1.7", brand)).toBe(
      "PassBundle CLI 0.1.7. It doesn't update itself: get the newest version from https://github.com/example/releases",
    );
  });
});
