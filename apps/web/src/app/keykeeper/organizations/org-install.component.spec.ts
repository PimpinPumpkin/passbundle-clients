import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { ClientEnrollment } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationData } from "@bitwarden/common/admin-console/models/data/organization.data";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ProfileOrganizationResponse } from "@bitwarden/common/admin-console/models/response/profile-organization.response";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
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

describe("what a phone's MDM sets, on the install command's card", () => {
  const FINGERPRINT = "c".repeat(43);

  afterEach(() => TestBed.resetTestingModule());

  /** The card as the page shows it, for someone the server answers this way. */
  async function render(
    organizations: Organization[],
    answer: ClientEnrollment | { provider: string; removedSinceToken: number } | Error,
  ): Promise<ComponentFixture<KeykeeperOrgInstallComponent>> {
    TestBed.resetTestingModule();
    const api = mock<KeykeeperMspApiService>();
    if (answer instanceof Error) {
      api.getOrgEnrollment.mockRejectedValue(answer);
    } else {
      api.getOrgEnrollment.mockResolvedValue(answer);
    }
    const environmentService = mock<EnvironmentService>();
    environmentService.environment$ = of({
      getWebVaultUrl: () => "https://vault.example.test",
    }) as any;
    const sealer = mock<KeykeeperJoinSealer>();
    sealer.commandParts.mockResolvedValue({
      secret: "b".repeat(43),
      fingerprint: FINGERPRINT,
      phrase: ["alpha", "bravo"],
    });
    const organizationService = mock<OrganizationService>();
    organizationService.organizations$.mockReturnValue(of(organizations));
    // Ours from brand/messages.en.json (a key that isn't there fails), the
    // script names brand.json gives at build time, and upstream's as their keys.
    const built: Record<string, string> = {
      keykeeperInstallScript: "Install-PassBundle.ps1",
      keykeeperInstallScriptMacLinux: "install-passbundle.sh",
      keykeeperMacProfile: "PassBundle.mobileconfig",
    };
    await TestBed.configureTestingModule({
      imports: [KeykeeperOrgInstallComponent],
      providers: [
        { provide: KeykeeperMspApiService, useValue: api },
        { provide: EnvironmentService, useValue: environmentService },
        { provide: DialogService, useValue: mock<DialogService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
        { provide: KeykeeperJoinSealer, useValue: sealer },
        {
          provide: AccountService,
          useValue: { activeAccount$: of({ id: "user" }) } as unknown as AccountService,
        },
        { provide: OrganizationService, useValue: organizationService },
        { provide: PlatformUtilsService, useValue: mock<PlatformUtilsService>() },
        {
          provide: I18nService,
          useValue: {
            t: (key: string, ...values: string[]) =>
              built[key] ?? (key.startsWith("keykeeper") ? translate(key, ...values) : key),
            translationLocale: "en-US",
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KeykeeperOrgInstallComponent);
    fixture.componentRef.setInput("organizationId", ORG);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const page = (fixture: ComponentFixture<KeykeeperOrgInstallComponent>) =>
    fixture.nativeElement as HTMLElement;
  const phoneValues = (fixture: ComponentFixture<KeykeeperOrgInstallComponent>) =>
    Array.from(page(fixture).querySelectorAll('[data-testid="org-install-phones"] [data-key]')).map(
      (row) => [
        row.getAttribute("data-key"),
        row.querySelector('[data-testid="org-install-phone-value"]')?.textContent?.trim(),
      ],
    );

  it.each([
    ["owner", 0],
    ["admin", 1],
  ] as const)(
    "a business's %s sees this organization's server and key fingerprint, next to the command",
    async (_who, type) => {
      const fixture = await render([business(type)], enrollment);

      expect(page(fixture).querySelector('[data-testid="org-install-command"]')).not.toBeNull();
      expect(phoneValues(fixture)).toEqual([
        ["server_url", "https://vault.example.test"],
        ["org_key_fingerprint", FINGERPRINT],
      ]);
    },
  );

  it.each([
    ["someone the server doesn't show the command to", () => new Error("Not found")],
    [
      "an admin of an MSP's client, whose command is in the MSP's console",
      () => ({ provider: "Northwind IT", removedSinceToken: 0 }),
    ],
  ])(
    "%s sees neither the command nor what phones get, which an admin sees",
    async (_who, answer) => {
      // The admin who sees the command sees the phones' values.
      const admin = await render([business(1)], enrollment);
      expect(phoneValues(admin)).toHaveLength(2);

      const other = await render([business(1)], answer());

      expect(page(other).querySelector('[data-testid="org-install-command"]')).toBeNull();
      expect(page(other).querySelector('[data-testid="org-install-phones"]')).toBeNull();
      expect(page(other).textContent).not.toContain(FINGERPRINT);
      expect(page(other).textContent).not.toContain("org_key_fingerprint");
    },
  );

  it("a family's owner, who has no install command, sees nothing for phones either, which a business's owner sees", async () => {
    const ownersCard = await render([business(0)], enrollment);
    expect(phoneValues(ownersCard)).toHaveLength(2);

    const familyOwner = await render([family(0)], enrollment);

    expect(page(familyOwner).querySelector('[data-testid="org-install"]')).toBeNull();
    expect(page(familyOwner).textContent).not.toContain(FINGERPRINT);
  });
});
