import { ActivatedRoute } from "@angular/router";
import { mock } from "jest-mock-extended";

import { ProvisioningView } from "@bitwarden/admin-console/common";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { confirmChangeStandIn, PROOF } from "../confirm-change/confirm-change.test-helper";
import { KeykeeperMspApiService } from "../msp/msp-api.service";
import { KeykeeperMspWorkService } from "../msp/msp-work.service";

import { KeykeeperProvisioningComponent } from "./provisioning.component";

const ORG = "11111111-2222-3333-4444-555555555555";

const view = (fields: Partial<ProvisioningView> = {}) =>
  ({
    scimUrl: `https://vault.example/scim/v2/${ORG}`,
    token: null,
    waiting: [],
    turnedOff: [],
    ...fields,
  }) as ProvisioningView;

function setUp() {
  const prompt = confirmChangeStandIn();
  const api = mock<KeykeeperMspApiService>();
  api.makeProvisioningToken.mockResolvedValue(view({ newToken: "pbscim1_new" }));
  const dialogService = mock<DialogService>();
  dialogService.openSimpleDialog.mockResolvedValue(true);
  const toastService = mock<ToastService>();
  const page = new KeykeeperProvisioningComponent(
    mock<ActivatedRoute>(),
    api,
    mock<KeykeeperMspWorkService>(),
    mock<PlatformUtilsService>(),
    dialogService,
    toastService,
    prompt.service,
  );
  page["organizationId"].set(ORG);
  page["view"].set(view());
  return { prompt, api, dialogService, toastService, page };
}

describe("the Provisioning page's token", () => {
  afterEach(() => jest.restoreAllMocks());

  it("isn't made when the person cancels the prompt", async () => {
    const { prompt, api, toastService, page } = setUp();
    prompt.cancels();

    await page["create"]();

    expect(prompt.open).toHaveBeenCalledTimes(1);
    expect(prompt.open.mock.calls[0][1].bodyText).toBe("keykeeperConfirmProvisioningToken");
    expect(api.makeProvisioningToken).not.toHaveBeenCalled();
    expect(page["madeToken"]()).toBeNull();
    expect(toastService.showToast).not.toHaveBeenCalled();
  });

  it("is made with the person's proof, and shown once", async () => {
    const { prompt, api, page } = setUp();
    prompt.confirms();

    await page["create"]();

    expect(api.makeProvisioningToken).toHaveBeenCalledWith(ORG, PROOF);
    expect(page["madeToken"]()).toBe("pbscim1_new");
    expect(page["view"]()?.newToken).toBeUndefined();
  });

  it("isn't replaced when the person heeds the warning but cancels the prompt", async () => {
    const { prompt, api, dialogService, toastService, page } = setUp();
    prompt.cancels();

    await page["replace"]();

    expect(dialogService.openSimpleDialog).toHaveBeenCalledTimes(1);
    expect(api.makeProvisioningToken).not.toHaveBeenCalled();
    expect(toastService.showToast).not.toHaveBeenCalled();
  });

  it("isn't replaced, and nothing is asked, when the person backs out at the warning", async () => {
    const { prompt, api, dialogService, page } = setUp();
    dialogService.openSimpleDialog.mockResolvedValue(false);

    await page["replace"]();

    expect(prompt.open).not.toHaveBeenCalled();
    expect(api.makeProvisioningToken).not.toHaveBeenCalled();
  });

  it("is replaced with the person's proof", async () => {
    const { prompt, api, toastService, page } = setUp();
    prompt.confirms();

    await page["replace"]();

    expect(api.makeProvisioningToken).toHaveBeenCalledWith(ORG, PROOF);
    expect(page["madeToken"]()).toBe("pbscim1_new");
    expect(toastService.showToast).toHaveBeenCalledWith({
      variant: "success",
      message: "Replaced the provisioning token",
    });
  });
});
