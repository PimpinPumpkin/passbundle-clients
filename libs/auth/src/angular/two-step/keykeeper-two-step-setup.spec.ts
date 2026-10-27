import { Router } from "@angular/router";
import { mock } from "jest-mock-extended";

import { AuthResult } from "@bitwarden/common/auth/models/domain/auth-result";
import { ClientType } from "@bitwarden/common/enums";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
// eslint-disable-next-line no-restricted-imports
import { DialogService } from "@bitwarden/components";

import {
  KEYKEEPER_TWO_STEP_SETUP,
  keykeeperNamesPhrase,
  keykeeperStartTwoStepSetup,
  keykeeperTakeTwoStepHandoff,
} from "./keykeeper-two-step-setup";

describe("keykeeperStartTwoStepSetup", () => {
  const setupResult = () => {
    const result = new AuthResult();
    result.keykeeperTwoStepSetup = {
      token: "setup-token",
      requiredBy: ["Acme Dental", "Contoso IT"],
      message: "",
      email: "ana@acme.test",
      masterPasswordHash: "server-hash",
    };
    return result;
  };

  const deps = (clientType: ClientType) => {
    const router = mock<Router>();
    const i18nService = mock<I18nService>();
    i18nService.t.mockImplementation(
      (key: string, ...args: unknown[]) => `${key}:${args.join("|")}`,
    );
    const dialogService = mock<DialogService>();
    const platformUtilsService = mock<PlatformUtilsService>();
    return {
      router,
      i18nService,
      dialogService,
      platformUtilsService,
      clientType,
      webVaultUrl: () => Promise.resolve("https://vault.example.test"),
    };
  };

  beforeEach(() => sessionStorage.clear());

  it("leaves any other result alone", async () => {
    const d = deps(ClientType.Web);
    expect(await keykeeperStartTwoStepSetup(new AuthResult(), d)).toBe(false);
    expect(d.router.navigate).not.toHaveBeenCalled();
  });

  it("takes the web vault to the setup page, keeping only the token in the tab and the hash in memory once", async () => {
    const d = deps(ClientType.Web);
    expect(await keykeeperStartTwoStepSetup(setupResult(), d)).toBe(true);
    expect(d.router.navigate).toHaveBeenCalledWith(["/two-step-setup"]);
    const kept = sessionStorage.getItem(KEYKEEPER_TWO_STEP_SETUP)!;
    expect(JSON.parse(kept)).toEqual({
      token: "setup-token",
      requiredBy: ["Acme Dental", "Contoso IT"],
    });
    expect(kept).not.toContain("server-hash");
    expect(keykeeperTakeTwoStepHandoff("another-token")).toBeNull();
    // Taken once: asking with another token already cleared it.
    expect(keykeeperTakeTwoStepHandoff("setup-token")).toBeNull();

    await keykeeperStartTwoStepSetup(setupResult(), d);
    expect(keykeeperTakeTwoStepHandoff("setup-token")).toEqual({
      token: "setup-token",
      email: "ana@acme.test",
      masterPasswordHash: "server-hash",
    });
    expect(keykeeperTakeTwoStepHandoff("setup-token")).toBeNull();
  });

  it("sends the extension and other apps to the web vault, and opens it when asked", async () => {
    const d = deps(ClientType.Browser);
    d.dialogService.openSimpleDialog.mockResolvedValue(true);
    expect(await keykeeperStartTwoStepSetup(setupResult(), d)).toBe(true);
    expect(d.router.navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEYKEEPER_TWO_STEP_SETUP)).toBeNull();
    expect(d.dialogService.openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: { key: "keykeeperTwoStepSetupTitle" },
        content:
          "keykeeperTwoStepSetupInWebVault:Acme Dental and Contoso IT|https://vault.example.test",
      }),
    );
    expect(d.platformUtilsService.launchUri).toHaveBeenCalledWith("https://vault.example.test");
  });

  it("doesn't open the web vault when the person closes the message", async () => {
    const d = deps(ClientType.Desktop);
    d.dialogService.openSimpleDialog.mockResolvedValue(false);
    await keykeeperStartTwoStepSetup(setupResult(), d);
    expect(d.platformUtilsService.launchUri).not.toHaveBeenCalled();
  });
});

describe("keykeeperNamesPhrase", () => {
  it("names one, two, or more", () => {
    expect(keykeeperNamesPhrase([])).toBe("");
    expect(keykeeperNamesPhrase(["A"])).toBe("A");
    expect(keykeeperNamesPhrase(["A", "B"])).toBe("A and B");
    expect(keykeeperNamesPhrase(["A", "B", "C"])).toBe("A, B, and C");
  });
});
