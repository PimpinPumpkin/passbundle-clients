import { NO_ERRORS_SCHEMA } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ReactiveFormsModule } from "@angular/forms";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyApiServiceAbstraction } from "@bitwarden/common/admin-console/abstractions/policy/policy-api.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { PolicyStatusResponse } from "@bitwarden/common/admin-console/models/response/policy-status.response";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { KeyService } from "@bitwarden/key-management";

import {
  VaultLockPolicy,
  VaultLockPolicyComponent,
  VAULT_LOCK_WAITS,
  waitLabel,
} from "./vault-lock-policy.component";

const ORG_ID = "org1" as OrganizationId;

const response = (enabled: boolean, data: object | null) =>
  new PolicyStatusResponse({
    OrganizationId: ORG_ID,
    Type: PolicyType.MaximumVaultTimeout,
    Enabled: enabled,
    Data: data,
  });

describe("VaultLockPolicy", () => {
  it("is upstream's vault timeout policy, as Vault lock", () => {
    const policy = new VaultLockPolicy();
    expect(policy.type).toBe(PolicyType.MaximumVaultTimeout);
    expect(policy.type).toBe(9);
    expect(policy.name).toBe("vaultLockPolicy");
    expect(policy.component).toBe(VaultLockPolicyComponent);
  });

  it("says each wait as a person would", () => {
    expect(VAULT_LOCK_WAITS.map(waitLabel)).toEqual([
      "1 minute",
      "5 minutes",
      "15 minutes",
      "30 minutes",
      "1 hour",
      "4 hours",
      "8 hours",
      "1 day",
    ]);
    expect(waitLabel(90)).toBe("1 hour 30 minutes");
    expect(waitLabel(121)).toBe("2 hours 1 minute");
  });
});

describe("VaultLockPolicyComponent", () => {
  let fixture: ComponentFixture<VaultLockPolicyComponent>;
  let component: VaultLockPolicyComponent;

  beforeEach(async () => {
    const policyService = mock<PolicyService>();
    policyService.policies$.mockReturnValue(of([]));
    const organizationService = mock<OrganizationService>();
    organizationService.organizations$.mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule],
      providers: [
        { provide: I18nService, useValue: { t: jest.fn().mockReturnValue("") } },
        { provide: OrganizationService, useValue: organizationService },
        { provide: PolicyService, useValue: policyService },
        { provide: AccountService, useValue: mockAccountServiceWith("user1" as UserId) },
        { provide: KeyService, useValue: mock<KeyService>() },
        { provide: PolicyApiServiceAbstraction, useValue: mock<PolicyApiServiceAbstraction>() },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  function open(enabled: boolean, data: object | null) {
    fixture = TestBed.createComponent(VaultLockPolicyComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput("policyResponse", response(enabled, data));
    fixture.detectChanges();
  }

  const saved = () => component["buildRequestData"]();
  const shown = () => component.data.getRawValue();
  const waits = () => component["waits"]();

  it("starts at 15 minutes, locking, when nothing is set", () => {
    open(false, null);
    expect(shown()).toEqual({ when: "custom", minutes: 15, action: "lock" });
    expect(saved()).toEqual({ type: "custom", minutes: 15, action: "lock" });
  });

  it("turns each choice into the data upstream's clients read, and back", () => {
    for (const data of [
      { type: "custom", minutes: 240, action: "lock" },
      { type: "immediately", minutes: null, action: "logOut" },
      { type: "onSystemLock", minutes: null, action: "lock" },
    ]) {
      open(true, data);
      expect(saved()).toEqual(data);
    }
  });

  it("drops the minutes when the type doesn't use them", () => {
    open(true, { type: "custom", minutes: 30, action: "lock" });
    component.data.controls.when.setValue("onSystemLock");
    expect(saved()).toEqual({ type: "onSystemLock", minutes: null, action: "lock" });
  });

  it("reads data set elsewhere: no type is a longest wait, and a wait not offered is added", () => {
    open(true, { minutes: 90 });
    expect(shown()).toEqual({ when: "custom", minutes: 90, action: "lock" });
    expect(waits()).toContain(90);
    expect(saved()).toEqual({ type: "custom", minutes: 90, action: "lock" });
  });

  it("shows upstream's types that limit nothing here as a longest wait, to choose again", () => {
    open(true, { type: "never", minutes: 0, action: "logOut" });
    expect(shown()).toEqual({ when: "custom", minutes: 15, action: "logOut" });
    expect(waits()).toEqual(VAULT_LOCK_WAITS);
  });
});
