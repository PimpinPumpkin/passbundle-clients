import { CommonModule } from "@angular/common";
import { NO_ERRORS_SCHEMA } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { TwoFactorService } from "@bitwarden/common/auth/two-factor";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { ProductTierType } from "@bitwarden/common/billing/enums";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { DialogService, ToastService } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { TwoFactorSetupComponent } from "./two-factor-setup.component";

// Keykeeper: the admin console's Two-step login page. Our server has no
// two-step login of an organization's own (upstream's organization Duo), so
// the page offers none and asks the server for none.
describe("the admin console's Two-step login page", () => {
  let fixture: ComponentFixture<TwoFactorSetupComponent>;
  let twoFactorService: MockProxy<TwoFactorService>;

  async function open(productTierType: ProductTierType) {
    twoFactorService = mock<TwoFactorService>();
    const organizationService = mock<OrganizationService>();
    organizationService.organizations$.mockReturnValue(
      of([{ id: "org-1", productTierType } as Organization]),
    );
    const policyService = mock<PolicyService>();
    policyService.policyAppliesToUser$.mockReturnValue(of(false));
    const billing = mock<BillingAccountProfileStateService>();
    billing.hasPremiumFromAnySource$.mockReturnValue(of(false));

    await TestBed.configureTestingModule({
      declarations: [TwoFactorSetupComponent],
      imports: [CommonModule, I18nPipe],
      providers: [
        { provide: ActivatedRoute, useValue: { params: of({ organizationId: "org-1" }) } },
        { provide: TwoFactorService, useValue: twoFactorService },
        { provide: OrganizationService, useValue: organizationService },
        { provide: PolicyService, useValue: policyService },
        { provide: BillingAccountProfileStateService, useValue: billing },
        { provide: AccountService, useValue: mockAccountServiceWith("user-1" as UserId) },
        { provide: ConfigService, useValue: { getFeatureFlag$: () => of(false) } },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: DialogService, useValue: mock<DialogService>() },
        { provide: MessagingService, useValue: mock<MessagingService>() },
        { provide: UserVerificationService, useValue: mock<UserVerificationService>() },
        { provide: ToastService, useValue: mock<ToastService>() },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(TwoFactorSetupComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it("says how to require two-step login of members, and nothing about Duo", async () => {
    const page = await open(ProductTierType.Enterprise);

    expect(page.textContent).toContain("twoStepLoginEnterpriseDescStart");
    expect(page.querySelector("a[routerLink='../policies']")?.textContent).toContain(
      "twoStepLoginPolicy",
    );
    expect(page.textContent).toContain("twoStepLoginOrganizationSsoDesc");
    expect(page.textContent).not.toContain("twoStepLoginOrganizationDuoDesc");
  });

  it("lists no providers, with no heading or spinner for them", async () => {
    const page = await open(ProductTierType.Enterprise);

    expect(fixture.componentInstance.providers).toEqual([]);
    expect(fixture.componentInstance.loading).toBe(false);
    expect(page.querySelector("h2")).toBeNull();
    expect(page.querySelector("bit-item-group")).toBeNull();
    expect(page.querySelector("bit-item")).toBeNull();
  });

  it("asks the server for no providers: it has no API for an organization's", async () => {
    await open(ProductTierType.Enterprise);

    expect(twoFactorService.getTwoFactorOrganizationProviders).not.toHaveBeenCalled();
    expect(twoFactorService.getEnabledTwoFactorProviders).not.toHaveBeenCalled();
  });

  it("says nothing about Duo to a family either", async () => {
    const page = await open(ProductTierType.Families);

    expect(page.textContent).toContain("twoStepLoginTeamsDesc");
    expect(page.textContent).not.toContain("twoStepLoginOrganizationDuoDesc");
    expect(page.querySelector("h2")).toBeNull();
  });
});
