import { changePasswordUrlFor } from "./change-password-urls";
import { SITE_CHANGE_PASSWORD_URLS } from "./site-change-password-urls.data";

describe("changePasswordUrlFor", () => {
  const table = {
    "shop.example": "https://shop.example/account/password",
    "login.bank.example": "https://login.bank.example/security",
  };

  it("finds a site's page from any of its subdomains, ignoring the port", () => {
    expect(changePasswordUrlFor("shop.example", table)).toBe(
      "https://shop.example/account/password",
    );
    expect(changePasswordUrlFor("WWW.shop.example:8443", table)).toBe(
      "https://shop.example/account/password",
    );
  });

  it("keeps a subdomain's page to that subdomain", () => {
    expect(changePasswordUrlFor("login.bank.example", table)).toBe(
      "https://login.bank.example/security",
    );
    expect(changePasswordUrlFor("bank.example", table)).toBeNull();
  });

  it("finds nothing for other sites", () => {
    expect(changePasswordUrlFor("other.example", table)).toBeNull();
    expect(changePasswordUrlFor("", table)).toBeNull();
    expect(changePasswordUrlFor(null, table)).toBeNull();
  });

  it("uses the published list by default, which holds only https pages", () => {
    expect(changePasswordUrlFor("www.1800contacts.com")).toBe(
      "https://www.1800contacts.com/account/settings",
    );
    expect(Object.values(SITE_CHANGE_PASSWORD_URLS).every((url) => /^https:\/\//.test(url))).toBe(
      true,
    );
  });
});
