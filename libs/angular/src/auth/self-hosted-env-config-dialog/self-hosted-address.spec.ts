import { TestBed } from "@angular/core/testing";
import { FormControl } from "@angular/forms";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";

import {
  onlyHttpsValidator,
  selfHostedAddress,
  selfHostedAddressHost,
  selfHostedAddressProblem,
} from "./self-hosted-env-config-dialog.component";

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

describe("selfHostedAddressProblem", () => {
  it("takes just a server, with a port or a path", () => {
    expect(selfHostedAddressProblem("https://vault.example.com")).toBeNull();
    expect(selfHostedAddressProblem("https://vault.example.com:8443/")).toBeNull();
    expect(selfHostedAddressProblem("https://example.com/vault")).toBeNull();
    expect(selfHostedAddressProblem("https://192.168.1.20")).toBeNull();
  });

  it("refuses a user name or password before the host, which hides the real host", () => {
    expect(selfHostedAddressProblem("https://passbundle.com@evil.example")).toBe("extras");
    expect(selfHostedAddressProblem("https://user:pass@vault.example.com")).toBe("extras");
    expect(selfHostedAddressProblem("https://@vault.example.com")).toBe("extras");
  });

  it("refuses a query or a fragment", () => {
    expect(selfHostedAddressProblem("https://vault.example.com/?next=evil")).toBe("extras");
    expect(selfHostedAddressProblem("https://vault.example.com/#top")).toBe("extras");
    expect(selfHostedAddressProblem("https://vault.example.com/?")).toBe("extras");
  });

  it("refuses what isn't a URL", () => {
    expect(selfHostedAddressProblem("https://")).toBe("invalid");
    expect(selfHostedAddressProblem("https://vault example.com")).toBe("invalid");
  });
});

describe("selfHostedAddressHost", () => {
  it("is the host the URL parser reads, an internationalized name in punycode", () => {
    expect(selfHostedAddressHost("https://bücher.example/vault")).toBe("xn--bcher-kva.example");
    expect(selfHostedAddressHost("https://vault.example.com:8443/identity")).toBe(
      "vault.example.com:8443",
    );
    expect(selfHostedAddressHost("not a url")).toBeNull();
    expect(selfHostedAddressHost(null)).toBeNull();
  });
});

describe("onlyHttpsValidator", () => {
  let isDev = false;
  const validate = (value: string) =>
    TestBed.runInInjectionContext(() => onlyHttpsValidator())(new FormControl(value));

  beforeEach(() => {
    isDev = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: PlatformUtilsService, useValue: { isDev: () => isDev } },
      ],
    });
  });

  it("takes an address without a scheme, and an https:// one", () => {
    expect(validate("test.passbundle.com")).toBeNull();
    expect(validate("https://vault.example.com")).toBeNull();
    expect(validate("")).toBeNull();
  });

  it("refuses http://, except in a development build", () => {
    expect(validate("http://vault.example.com")).toEqual({
      onlyHttpsAllowed: { message: "selfHostedEnvMustUseHttps" },
    });
    isDev = true;
    expect(validate("http://vault.example.com")).toBeNull();
  });

  it("refuses an address with a user name, a query, or a fragment, in the dialog too", () => {
    for (const address of [
      "passbundle.com@evil.example",
      "https://user:pass@vault.example.com",
      "vault.example.com/?next=evil",
      "vault.example.com/#top",
    ]) {
      expect(validate(address)).toEqual({
        keykeeperServerAddress: { message: "keykeeperServerAddressOnly" },
      });
    }
    expect(validate("vault example.com")).toEqual({
      keykeeperServerAddress: { message: "keykeeperServerAddressInvalid" },
    });
  });
});
