import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { OrganizationData } from "@bitwarden/common/admin-console/models/data/organization.data";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ProfileOrganizationResponse } from "@bitwarden/common/admin-console/models/response/profile-organization.response";
import { DialogService, ToastService } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperInstallTokenPromptComponent } from "./install-token-prompt.component";

const ORG = "11111111-2222-3333-4444-555555555555";

/** The organization as a sync gives it (type 0 owner, 1 admin, 2 user). */
function synced(type: 0 | 1 | 2, usePolicies: boolean): Organization {
  const response = new ProfileOrganizationResponse({
    Id: ORG,
    Name: "Rivera",
    Enabled: true,
    Type: type,
    Status: 2,
    // A family where plans are enforced has the company features off together.
    UsePolicies: usePolicies,
    UseGroups: usePolicies,
    UseResetPassword: usePolicies,
    ProductTierType: usePolicies ? 3 : 1,
  });
  return new Organization(
    new OrganizationData(response, { isMember: true, isProviderUser: false }),
  );
}

function setUp() {
  const api = mock<KeykeeperMspApiService>();
  const prompt = TestBed.runInInjectionContext(
    () =>
      new KeykeeperInstallTokenPromptComponent(api, mock<DialogService>(), mock<ToastService>()),
  );
  const p = prompt as unknown as {
    load(org: Organization): Promise<void>;
    prompt: () => { text: string; canReplace: boolean } | null;
  };
  return { api, p };
}

describe("the Members page's offer to replace the install token", () => {
  it.each([
    ["owner", 0],
    ["admin", 1],
  ] as const)("a family's %s: no offer, and nothing is asked of the server", async (_who, type) => {
    const { api, p } = setUp();

    await p.load(synced(type, false));

    expect(api.getOrgEnrollment).not.toHaveBeenCalled();
    expect(p.prompt()).toBeNull();
  });

  it("a business's admin, after someone was removed: the offer, with Replace token", async () => {
    const { api, p } = setUp();
    api.getOrgEnrollment.mockResolvedValue({
      token: "a".repeat(43),
      createdAt: "2026-11-01T09:00:00.000Z",
      joins: 3,
      domains: [],
      removedSinceToken: 1,
    });

    await p.load(synced(1, true));

    expect(api.getOrgEnrollment).toHaveBeenCalledWith(ORG);
    expect(p.prompt()).toEqual({
      text: expect.stringContaining("1 person was removed since the install command was made."),
      canReplace: true,
    });
  });

  it("a member who isn't an owner or admin: no offer, and nothing is asked", async () => {
    const { api, p } = setUp();

    await p.load(synced(2, true));

    expect(api.getOrgEnrollment).not.toHaveBeenCalled();
    expect(p.prompt()).toBeNull();
  });
});
