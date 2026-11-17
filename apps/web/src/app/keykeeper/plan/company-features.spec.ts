import { OrganizationData } from "@bitwarden/common/admin-console/models/data/organization.data";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ProfileOrganizationResponse } from "@bitwarden/common/admin-console/models/response/profile-organization.response";

import { hasCompanyFeatures } from "./company-features";

/** An organization as a sync gives it, with these of its fields. */
function synced(fields: Record<string, unknown>): Organization {
  const response = new ProfileOrganizationResponse({
    Id: "org-1",
    Name: "Rivera family",
    Enabled: true,
    Type: 0,
    Status: 2,
    ...fields,
  });
  return new Organization(
    new OrganizationData(response, { isMember: true, isProviderUser: false }),
  );
}

describe("hasCompanyFeatures", () => {
  it("is what the server says for every organization where plans aren't enforced, and for Business", () => {
    // As the server sends every organization today, events and upstream's SCIM off.
    expect(
      hasCompanyFeatures(
        synced({
          UsePolicies: true,
          UseGroups: false,
          UseEvents: false,
          UseScim: false,
          Seats: 20,
          ProductTierType: 3,
        }),
      ),
    ).toBe(true);
  });

  it("is off for a family, whose company features the server turns off together", () => {
    expect(
      hasCompanyFeatures(
        synced({
          UsePolicies: false,
          UseGroups: false,
          UseEvents: false,
          UseSso: false,
          UseScim: false,
          UseResetPassword: false,
          UseCustomPermissions: false,
          UseApi: false,
          Seats: 6,
          ProductTierType: 1,
        }),
      ),
    ).toBe(false);
  });

  it("is off for an organization that says nothing", () => {
    expect(hasCompanyFeatures(new Organization())).toBe(false);
  });
});
