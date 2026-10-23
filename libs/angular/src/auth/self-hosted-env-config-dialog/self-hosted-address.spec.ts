import { selfHostedAddress } from "./self-hosted-env-config-dialog.component";

describe("selfHostedAddress", () => {
  it("adds https:// when the scheme is left off", () => {
    expect(selfHostedAddress("test.passbundle.com")).toBe("https://test.passbundle.com");
    expect(selfHostedAddress("  vault.example.com:8443/  ")).toBe(
      "https://vault.example.com:8443/",
    );
    expect(selfHostedAddress("192.168.1.20")).toBe("https://192.168.1.20");
  });

  it("keeps an address that names its scheme, lowercasing it", () => {
    expect(selfHostedAddress("https://vault.example.com")).toBe("https://vault.example.com");
    expect(selfHostedAddress("HTTPS://vault.example.com")).toBe("https://vault.example.com");
    expect(selfHostedAddress("http://vault.example.com")).toBe("http://vault.example.com");
  });

  it("leaves an empty field empty", () => {
    expect(selfHostedAddress("   ")).toBe("");
    expect(selfHostedAddress(null)).toBe("");
  });
});
