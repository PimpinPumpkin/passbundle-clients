import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { mock } from "jest-mock-extended";

import { KeykeeperTwoStepDetour } from "./two-step-detour";

describe("KeykeeperTwoStepDetour", () => {
  let router: ReturnType<typeof mock<Router>>;
  let detour: KeykeeperTwoStepDetour;

  beforeEach(() => {
    router = mock<Router>();
    router.navigate.mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
    detour = TestBed.inject(KeykeeperTwoStepDetour);
  });

  it("goes to the Two-step login page, and back to the page it came from", async () => {
    await detour.start({ path: "/msp", label: "Set up your MSP", name: "Northwind IT" });
    expect(router.navigate).toHaveBeenLastCalledWith(["/settings/security/two-factor"]);
    expect(detour.current()?.label).toBe("Set up your MSP");

    await detour.goBack();
    expect(router.navigate).toHaveBeenLastCalledWith(["/msp"]);
  });

  it("gives the form back once, and only to the page that left it", async () => {
    await detour.start({
      path: "/create-organization",
      label: "New organization",
      name: "Acme Dental",
      preset: "business",
    });

    expect(detour.take("/msp")).toBeNull();
    expect(detour.take("/create-organization")).toEqual({
      path: "/create-organization",
      label: "New organization",
      name: "Acme Dental",
      preset: "business",
    });
    expect(detour.take("/create-organization")).toBeNull();
    expect(detour.current()).toBeNull();
  });

  it("goes nowhere without a detour", async () => {
    await detour.goBack();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
