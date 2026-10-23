import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter, Router, RouterModule } from "@angular/router";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { NavigationModule, PopoverModule, SideNavService, SvgModule } from "@bitwarden/components";
import { SendPolicyService } from "@bitwarden/send-ui";
import { PremiumSubscriptionRoutingService } from "@bitwarden/web-vault/app/billing/individual/services/premium-subscription-routing.service";

import { KeykeeperMspApiService } from "../keykeeper/msp/msp-api.service";
import { KEYKEEPER_MENU_BUTTON } from "../keykeeper/vault-menu/menu-button";
import { CoachmarkComponent, CoachmarkService } from "../vault/components/coachmark";

import { UserLayoutComponent } from "./user-layout.component";

@Component({
  selector: "app-layout",
  template: "<ng-content />",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class LayoutStubComponent {}

@Component({
  selector: "app-side-nav",
  template: "<ng-content />",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SideNavStubComponent {}

@Component({
  selector: "app-keykeeper-vault-menu",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class VaultMenuStubComponent {}

@Component({
  selector: "billing-free-families-nav-item",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class FreeFamiliesStubComponent {}

@Component({ template: "", changeDetection: ChangeDetectionStrategy.OnPush })
class PageComponent {}

describe("UserLayoutComponent", () => {
  let fixture: ComponentFixture<UserLayoutComponent>;
  const open = signal(true);
  const pushMode = signal(true);
  const sideNav = {
    open,
    isOverlay: computed(() => open() && !pushMode()),
    toggle: jest.fn(),
  };
  let mspList: jest.Mock;

  async function create() {
    fixture = TestBed.createComponent(UserLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    open.set(true);
    pushMode.set(true);
    mspList = jest.fn().mockResolvedValue([]);
    const policyService = mock<PolicyService>();
    policyService.policyAppliesToUser$.mockReturnValue(of(false));

    await TestBed.configureTestingModule({
      imports: [UserLayoutComponent],
      providers: [
        provideRouter([
          { path: "vault", component: PageComponent },
          { path: "sends", component: PageComponent },
        ]),
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: SyncService, useValue: { fullSync: jest.fn() } },
        { provide: AccountService, useValue: mockAccountServiceWith("user-1" as UserId) },
        { provide: PolicyService, useValue: policyService },
        { provide: SendPolicyService, useValue: { disableSend$: of(false) } },
        {
          provide: PremiumSubscriptionRoutingService,
          useValue: { getSubscriptionRoute$: () => of(null) },
        },
        { provide: KeykeeperMspApiService, useValue: { list: () => mspList() } },
        { provide: SideNavService, useValue: sideNav },
        {
          provide: CoachmarkService,
          useValue: {
            activeStepId: signal(null),
            getStepPosition: () => undefined,
            getStepTitle: () => "",
            getStepDescription: () => "",
            getStepLearnMoreUrl: () => undefined,
            currentStepNumber: () => 1,
            totalSteps: () => 1,
          },
        },
      ],
    })
      .overrideComponent(UserLayoutComponent, {
        set: {
          imports: [
            CommonModule,
            RouterModule,
            JslibModule,
            NavigationModule,
            SvgModule,
            PopoverModule,
            CoachmarkComponent,
            LayoutStubComponent,
            SideNavStubComponent,
            VaultMenuStubComponent,
            FreeFamiliesStubComponent,
          ],
        },
      })
      .compileComponents();
  });

  /** The menu top to bottom: the vault's part, the divider, then each tool. */
  function menu(): string[] {
    const nav = fixture.nativeElement.querySelector("app-side-nav") as HTMLElement;
    return Array.from(nav.children)
      .filter((el) => el.tagName !== "APP-COACHMARK")
      .map((el) =>
        el.tagName === "BIT-NAV-ITEM" || el.tagName === "BIT-NAV-GROUP"
          ? el.querySelector("[data-testid=nav-item-interactive]")!.textContent!.trim()
          : el.tagName.toLowerCase(),
      );
  }

  it("is one menu: the vault's filters, then the tools", async () => {
    await create();

    expect(menu()).toEqual([
      "bit-nav-logo",
      "app-keykeeper-vault-menu",
      "bit-nav-divider",
      "generator",
      "send",
      "keykeeperImportAndExport",
      "settings",
    ]);
  });

  it("adds the MSP console for MSP staff, before Settings", async () => {
    mspList.mockResolvedValue([{ id: "msp-1" }]);
    await create();

    expect(menu().slice(-2)).toEqual(["keykeeperMspConsole", "settings"]);
  });

  it("keeps import and export together", async () => {
    await create();
    const group = fixture.nativeElement.querySelector("bit-nav-group") as HTMLElement;
    group.querySelector<HTMLElement>("[data-testid=nav-group-collapse-arrow]")!.click();
    fixture.detectChanges();

    const inside = Array.from(group.querySelectorAll("[role=group] bit-nav-item")).map((item) =>
      item.textContent!.trim(),
    );
    expect(inside).toEqual(["importNoun", "exportNoun"]);
  });

  it("asks its pages for a menu button on a phone", async () => {
    await create();

    expect(fixture.debugElement.injector.get(KEYKEEPER_MENU_BUTTON)).toBe(true);
  });

  it("closes the menu covering the page when another page opens, and not for a search", async () => {
    await create();
    const router = TestBed.inject(Router);
    await router.navigateByUrl("/vault");
    pushMode.set(false);

    await router.navigateByUrl("/vault?search=bank");
    expect(open()).toBe(true);

    await router.navigateByUrl("/sends");
    expect(open()).toBe(false);
  });
});
