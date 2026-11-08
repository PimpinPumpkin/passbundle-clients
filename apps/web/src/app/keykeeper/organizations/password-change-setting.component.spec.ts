import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { OrgPasswordChange } from "@bitwarden/admin-console/common";
import { ToastService } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperPasswordChangeSettingComponent } from "./password-change-setting.component";

const ORG = "11111111-2222-3333-4444-555555555555";

function setUp() {
  const api = mock<KeykeeperMspApiService>();
  const toastService = mock<ToastService>();
  const card = TestBed.runInInjectionContext(
    () => new KeykeeperPasswordChangeSettingComponent(api, toastService),
  );
  // The organization the card is for, as its page gives it.
  (card as unknown as { organizationId: () => string }).organizationId = () => ORG;
  return { card, api, toastService };
}

const view = (card: KeykeeperPasswordChangeSettingComponent) =>
  card as unknown as {
    setting: () => OrgPasswordChange | null;
    form: {
      controls: { allowed: { value: boolean; disabled: boolean; setValue(v: boolean): void } };
    };
    show(s: OrgPasswordChange): void;
    save(): Promise<void>;
  };

describe("KeykeeperPasswordChangeSettingComponent", () => {
  it("shows the organization's setting, and saves the box as it's ticked", async () => {
    const { card, api, toastService } = setUp();
    const c = view(card);
    c.show({ allowed: true, msp: null, requiredByMsp: false });
    expect(c.form.controls.allowed.value).toBe(true);
    api.setOrgPasswordChange.mockResolvedValue({ allowed: false, msp: null, requiredByMsp: false });
    c.form.controls.allowed.setValue(false);
    await c.save();
    expect(api.setOrgPasswordChange).toHaveBeenCalledWith(ORG, false);
    expect(c.setting()?.allowed).toBe(false);
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Assisted password change is off" }),
    );
  });

  it("locks the box while the MSP requires its setting for every client", () => {
    const { card } = setUp();
    const c = view(card);
    c.show({ allowed: false, msp: { id: "msp", name: "Northwind IT" }, requiredByMsp: true });
    expect(c.form.controls.allowed.disabled).toBe(true);
    c.show({ allowed: false, msp: { id: "msp", name: "Northwind IT" }, requiredByMsp: false });
    expect(c.form.controls.allowed.disabled).toBe(false);
  });

  it("says what went wrong when the server refuses", async () => {
    const { card, api, toastService } = setUp();
    const c = view(card);
    c.show({ allowed: true, msp: null, requiredByMsp: false });
    api.setOrgPasswordChange.mockRejectedValue(
      new Error("Northwind IT requires this policy for every client."),
    );
    await c.save();
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
    expect(c.setting()?.allowed).toBe(true);
  });
});
