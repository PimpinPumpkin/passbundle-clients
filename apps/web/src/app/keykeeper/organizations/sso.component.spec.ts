import { FormBuilder } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { mock } from "jest-mock-extended";

import { SsoView } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { confirmChangeStandIn, PROOF } from "../confirm-change/confirm-change.test-helper";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperSsoComponent } from "./sso.component";

const ORG = "11111111-2222-3333-4444-555555555555";

function setUp() {
  const prompt = confirmChangeStandIn();
  const api = mock<KeykeeperMspApiService>();
  api.saveSso.mockResolvedValue({
    enabled: true,
    identifier: "acme-dental",
    tenantId: "tenant",
    clientId: "client",
  } as SsoView);
  const toastService = mock<ToastService>();
  const page = new KeykeeperSsoComponent(
    mock<ActivatedRoute>(),
    new FormBuilder(),
    api,
    mock<PlatformUtilsService>(),
    mock<DialogService>(),
    toastService,
    prompt.service,
  );
  page["organizationId"].set(ORG);
  page["form"].setValue({
    enabled: true,
    identifier: " acme-dental ",
    tenantId: "tenant",
    clientId: "client",
    clientSecret: " secret ",
  });
  return { prompt, api, toastService, page };
}

describe("saving the Single sign-on page", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends nothing when the person cancels the prompt", async () => {
    const { prompt, api, toastService, page } = setUp();
    prompt.cancels();

    await page["save"]();

    expect(prompt.open.mock.calls[0][1].bodyText).toBe("keykeeperConfirmSsoSettings");
    expect(api.saveSso).not.toHaveBeenCalled();
    expect(toastService.showToast).not.toHaveBeenCalled();
    // What they typed is still there to save.
    expect(page["form"].getRawValue().clientSecret).toBe(" secret ");
  });

  it("sends the settings with the person's proof", async () => {
    const { prompt, api, toastService, page } = setUp();
    prompt.confirms();

    await page["save"]();

    expect(api.saveSso).toHaveBeenCalledWith(
      ORG,
      {
        enabled: true,
        identifier: "acme-dental",
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      },
      PROOF,
    );
    expect(toastService.showToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Single sign-on is on",
    });
    // The secret is never shown again.
    expect(page["form"].getRawValue().clientSecret).toBe("");
  });

  it("says why when the server refuses the settings", async () => {
    const { prompt, api, toastService, page } = setUp();
    prompt.confirms();
    const message = "Microsoft doesn't know that tenant.";
    api.saveSso.mockRejectedValue(
      new ErrorResponse({ message, validationErrors: { "": [message] } }, 400),
    );

    await page["save"]();

    expect(toastService.showToast).toHaveBeenCalledWith({ variant: "error", message });
  });
});
