import { TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { ClientEnrollment } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationData } from "@bitwarden/common/admin-console/models/data/organization.data";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ProfileOrganizationResponse } from "@bitwarden/common/admin-console/models/response/profile-organization.response";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { KeykeeperJoinSealer } from "../joining/join-sealer.service";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperOrgInstallComponent } from "./org-install.component";

const ORG = "11111111-2222-3333-4444-555555555555";

/** The organization as a sync gives it to an owner or admin (type 0 owner, 1 admin). */
function synced(type: 0 | 1, fields: Record<string, unknown>): Organization {
  const response = new ProfileOrganizationResponse({
    Id: ORG,
    Name: "Rivera",
    Enabled: true,
    Type: type,
    Status: 2,
    ...fields,
  });
  return new Organization(
    new OrganizationData(response, { isMember: true, isProviderUser: false }),
  );
}

/** As the server sends a family where plans are enforced: the company features off together. */
const family = (type: 0 | 1) =>
  synced(type, {
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
  });

/** As the server sends a business, and every organization where plans aren't enforced. */
const business = (type: 0 | 1) =>
  synced(type, { UsePolicies: true, UseGroups: true, UseResetPassword: true, ProductTierType: 3 });

const enrollment: ClientEnrollment = {
  token: "a".repeat(43),
  createdAt: "2026-11-01T09:00:00.000Z",
  joins: 2,
  domains: [],
  secret: "2.aXY=|ZGF0YQ==|bWFj",
  removedSinceToken: 0,
  browserAutofill: "unchanged",
};

function setUp(organizations: Organization[]) {
  const api = mock<KeykeeperMspApiService>();
  const environmentService = mock<EnvironmentService>();
  environmentService.environment$ = of({
    getWebVaultUrl: () => "https://vault.example.test",
  }) as any;
  const sealer = mock<KeykeeperJoinSealer>();
  sealer.commandParts.mockResolvedValue({
    secret: "b".repeat(43),
    fingerprint: "c".repeat(43),
    phrase: ["alpha", "bravo"],
  });
  const accountService = { activeAccount$: of({ id: "user" }) } as unknown as AccountService;
  const organizationService = mock<OrganizationService>();
  organizationService.organizations$.mockReturnValue(of(organizations));
  const card = TestBed.runInInjectionContext(
    () =>
      new KeykeeperOrgInstallComponent(
        new FormBuilder(),
        api,
        environmentService,
        mock<DialogService>(),
        mock<ToastService>(),
        sealer,
        accountService,
        organizationService,
      ),
  );
  // The organization the card is for, as Joining and security gives it.
  (card as unknown as { organizationId: () => string }).organizationId = () => ORG;
  const c = card as unknown as {
    load(orgId: string): Promise<void>;
    state: () => { kind: string; provider?: string; enrollment?: ClientEnrollment } | null;
  };
  return { api, c };
}

describe("the install command's card on Joining and security", () => {
  it.each([
    ["owner", 0],
    ["admin", 1],
  ] as const)(
    "a family's %s: the card stays hidden, and nothing is asked of the server",
    async (_who, type) => {
      const { api, c } = setUp([family(type)]);

      await c.load(ORG);

      expect(api.getOrgEnrollment).not.toHaveBeenCalled();
      expect(api.setOrgEnrollmentSecret).not.toHaveBeenCalled();
      expect(c.state()).toBeNull();
    },
  );

  it.each([
    ["owner", 0],
    ["admin", 1],
  ] as const)("a business's %s: the card asks, and shows the command", async (_who, type) => {
    const { api, c } = setUp([business(type)]);
    api.getOrgEnrollment.mockResolvedValue(enrollment);

    await c.load(ORG);

    expect(api.getOrgEnrollment).toHaveBeenCalledWith(ORG);
    expect(c.state()).toEqual(expect.objectContaining({ kind: "own", enrollment }));
  });

  it("an MSP's client: the card says which IT provider manages the command", async () => {
    const { api, c } = setUp([business(1)]);
    api.getOrgEnrollment.mockResolvedValue({ provider: "Northwind IT", removedSinceToken: 0 });

    await c.load(ORG);

    expect(c.state()).toEqual({ kind: "provider", provider: "Northwind IT" });
  });

  it("an organization the sync doesn't have is asked about, and hides on the server's not found", async () => {
    const { api, c } = setUp([]);
    api.getOrgEnrollment.mockRejectedValue(new Error("Organization not found"));

    await c.load(ORG);

    expect(api.getOrgEnrollment).toHaveBeenCalledWith(ORG);
    expect(c.state()).toBeNull();
  });
});
