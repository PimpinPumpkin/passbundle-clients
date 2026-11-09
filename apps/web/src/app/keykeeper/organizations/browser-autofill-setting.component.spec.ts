import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { OrgBrowserAutofill } from "@bitwarden/admin-console/common";
import { ToastService } from "@bitwarden/components";

import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperBrowserAutofillSettingComponent } from "./browser-autofill-setting.component";

const ORG = "11111111-2222-3333-4444-555555555555";
type Mode = OrgBrowserAutofill["mode"];

function setUp() {
  const api = mock<KeykeeperMspApiService>();
  const toastService = mock<ToastService>();
  const card = TestBed.runInInjectionContext(
    () => new KeykeeperBrowserAutofillSettingComponent(api, toastService),
  );
  // The organization the card is for, as its page gives it.
  (card as unknown as { organizationId: () => string }).organizationId = () => ORG;
  return { card, api, toastService };
}

const view = (card: KeykeeperBrowserAutofillSettingComponent) =>
  card as unknown as {
    setting: () => OrgBrowserAutofill | null;
    form: { controls: { mode: { value: Mode; disabled: boolean; setValue(v: Mode): void } } };
    show(s: OrgBrowserAutofill): void;
    save(): Promise<void>;
  };

describe("KeykeeperBrowserAutofillSettingComponent", () => {
  it("shows the organization's setting, and saves the choice", async () => {
    const { card, api, toastService } = setUp();
    const c = view(card);
    c.show({ mode: "unchanged", msp: null, requiredByMsp: false });
    expect(c.form.controls.mode.value).toBe("unchanged");
    api.setOrgBrowserAutofill.mockResolvedValue({
      mode: "offAndImport",
      msp: null,
      requiredByMsp: false,
    });
    c.form.controls.mode.setValue("offAndImport");
    await c.save();
    expect(api.setOrgBrowserAutofill).toHaveBeenCalledWith(ORG, "offAndImport");
    expect(c.setting()?.mode).toBe("offAndImport");
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: "The browsers' card and address autofill are off, with the offer to bring them in",
      }),
    );
  });

  it("locks the choice while the MSP requires its setting for every client", () => {
    const { card } = setUp();
    const c = view(card);
    const msp = { id: "msp", name: "Northwind IT" };
    c.show({ mode: "off", msp, requiredByMsp: true });
    expect(c.form.controls.mode.disabled).toBe(true);
    c.show({ mode: "off", msp, requiredByMsp: false });
    expect(c.form.controls.mode.disabled).toBe(false);
  });

  it("says what went wrong when the server refuses, and keeps what was saved", async () => {
    const { card, api, toastService } = setUp();
    const c = view(card);
    c.show({ mode: "unchanged", msp: null, requiredByMsp: false });
    api.setOrgBrowserAutofill.mockRejectedValue(
      new Error("Northwind IT requires this policy for every client."),
    );
    c.form.controls.mode.setValue("off");
    await c.save();
    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
    expect(c.setting()?.mode).toBe("unchanged");
  });
});
