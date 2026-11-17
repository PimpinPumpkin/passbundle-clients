import { showsTwoStepCode } from "./two-step-codes";

describe("Keykeeper: two-step codes need Premium", () => {
  it("shows codes with Premium, of one's own or through an organization", () => {
    // `hasPremiumFromAnySource$` covers both the profile's `premium` and
    // `premiumFromOrganization`.
    expect(showsTwoStepCode({ organizationUseTotp: false }, true)).toBe(true);
    expect(showsTwoStepCode({}, true)).toBe(true);
  });

  it("shows an item's codes without Premium where its organization gives them", () => {
    expect(showsTwoStepCode({ organizationUseTotp: true }, false)).toBe(true);
  });

  it("shows none without either", () => {
    expect(showsTwoStepCode({ organizationUseTotp: false }, false)).toBe(false);
    expect(showsTwoStepCode({ organizationUseTotp: null }, false)).toBe(false);
    expect(showsTwoStepCode({}, false)).toBe(false);
  });

  it("shows every code where plans aren't enforced, since the server says everyone has Premium", () => {
    expect(showsTwoStepCode({}, true)).toBe(true);
    expect(showsTwoStepCode({ organizationUseTotp: true }, true)).toBe(true);
  });
});
