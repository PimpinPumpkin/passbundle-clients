import { TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { mock } from "jest-mock-extended";

import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { confirmChangeStandIn, PROOF } from "../confirm-change/confirm-change.test-helper";

import { Destination, requestFor, StreamingScope } from "./event-streaming";
import { KeykeeperEventStreamingApiService } from "./event-streaming-api.service";
import { KeykeeperEventStreamingComponent } from "./event-streaming.component";

const scope: StreamingScope = { kind: "msp", id: "msp-1" };

const destination = {
  id: "d-1",
  name: "SOC",
  kind: "webhook",
  enabled: true,
  signingSecret: undefined,
} as unknown as Destination;

function setUp() {
  const prompt = confirmChangeStandIn();
  const api = mock<KeykeeperEventStreamingApiService>();
  api.list.mockResolvedValue({ data: [] } as any);
  api.create.mockResolvedValue({ ...destination, signingSecret: "whsec_new" });
  api.setEnabled.mockResolvedValue(destination);
  api.newSecret.mockResolvedValue({ ...destination, signingSecret: "whsec_new" });
  const dialogService = mock<DialogService>();
  dialogService.openSimpleDialog.mockResolvedValue(true);
  const toastService = mock<ToastService>();
  const section = TestBed.runInInjectionContext(
    () =>
      new KeykeeperEventStreamingComponent(
        new FormBuilder(),
        api,
        toastService,
        dialogService,
        mock<PlatformUtilsService>(),
        prompt.service,
      ),
  );
  // The section's input, as the MSP console binds it.
  Object.assign(section, { scope: () => scope });
  return { prompt, api, dialogService, toastService, section };
}

describe("event destinations, confirmed", () => {
  afterEach(() => jest.restoreAllMocks());

  const fillWebhook = (section: KeykeeperEventStreamingComponent) => {
    section["add"]();
    section["form"].patchValue({ name: "SOC", url: "https://siem.example/hook" });
  };

  it("adds nothing, and keeps the form, when the person cancels the prompt", async () => {
    const { prompt, api, toastService, section } = setUp();
    prompt.cancels();
    fillWebhook(section);

    await section["save"]();

    expect(prompt.open.mock.calls[0][1].bodyText).toBe("keykeeperConfirmEventDestination");
    expect(api.create).not.toHaveBeenCalled();
    expect(section["editing"]()).toBeNull();
    expect(section["form"].getRawValue().url).toBe("https://siem.example/hook");
    expect(toastService.showToast).not.toHaveBeenCalled();
  });

  it("adds one with the person's proof, and shows its signing secret once", async () => {
    const { prompt, api, section } = setUp();
    prompt.confirms();
    fillWebhook(section);
    const request = requestFor(section["form"].getRawValue(), null);

    await section["save"]();

    expect(api.create).toHaveBeenCalledWith(scope, request, PROOF);
    expect(section["made"]()).toEqual({ name: "SOC", secret: "whsec_new" });
    expect(section["editing"]()).toBeUndefined();
  });

  it("changes one with the person's proof", async () => {
    const { prompt, api, section } = setUp();
    prompt.confirms();
    api.update.mockResolvedValue({ ...destination, name: "SOC webhook" });
    section["edit"](destination);
    section["form"].patchValue({ name: "SOC webhook" });
    const request = requestFor(section["form"].getRawValue(), destination);

    await section["save"]();

    expect(api.update).toHaveBeenCalledWith(scope, "d-1", request, PROOF);
  });

  it("doesn't turn one on when the person cancels the prompt", async () => {
    const { prompt, api, section } = setUp();
    prompt.cancels();

    await section["setEnabled"]({ ...destination, enabled: false }, true);

    expect(api.setEnabled).not.toHaveBeenCalled();
  });

  it("turns one off after the warning and the prompt", async () => {
    const { prompt, api, dialogService, section } = setUp();
    prompt.confirms();

    await section["setEnabled"](destination, false);

    expect(dialogService.openSimpleDialog).toHaveBeenCalledTimes(1);
    expect(api.setEnabled).toHaveBeenCalledWith(scope, "d-1", false, PROOF);
  });

  it("makes no new signing secret when the person cancels the prompt", async () => {
    const { prompt, api, section } = setUp();
    prompt.cancels();

    await section["newSecret"](destination);

    expect(prompt.open.mock.calls[0][1].bodyText).toBe("keykeeperConfirmSigningSecret");
    expect(api.newSecret).not.toHaveBeenCalled();
    expect(section["made"]()).toBeNull();
  });

  it("makes a new signing secret with the person's proof", async () => {
    const { prompt, api, section } = setUp();
    prompt.confirms();

    await section["newSecret"](destination);

    expect(api.newSecret).toHaveBeenCalledWith(scope, "d-1", PROOF);
    expect(section["made"]()).toEqual({ name: "SOC", secret: "whsec_new" });
  });
});
