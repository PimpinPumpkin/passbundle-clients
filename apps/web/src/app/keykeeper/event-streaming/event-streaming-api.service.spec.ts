import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";

import { StreamingScope } from "./event-streaming";
import { KeykeeperEventStreamingApiService } from "./event-streaming-api.service";

const org: StreamingScope = { kind: "organization", id: "org-1" };
const msp: StreamingScope = { kind: "msp", id: "msp-1" };
const password = { masterPasswordHash: "server-hash" };
const webhook = { name: "SOC", kind: "webhook", webhook: { url: "https://siem.example/hook" } };

function setUp() {
  const apiService = mock<ApiService>();
  apiService.send.mockResolvedValue({});
  return { apiService, api: new KeykeeperEventStreamingApiService(apiService) };
}

describe("event streaming requests with the person's proof", () => {
  it("adds a destination with its settings and the master password hash", async () => {
    const { apiService, api } = setUp();
    await api.create(org, webhook, password);
    expect(apiService.send).toHaveBeenCalledWith(
      "POST",
      "/keykeeper/organizations/org-1/event-streaming",
      { ...webhook, masterPasswordHash: "server-hash" },
      true,
      true,
    );
  });

  it("changes one in an MSP's feed with a code, for an account without a master password", async () => {
    const { apiService, api } = setUp();
    await api.update(msp, "d-1", { name: "SOC feed" }, { otp: "123456" });
    expect(apiService.send).toHaveBeenCalledWith(
      "PUT",
      "/keykeeper/msp/msp-1/event-streaming/d-1",
      { name: "SOC feed", otp: "123456" },
      true,
      true,
    );
  });

  it("turns one on or off as a change", async () => {
    const { apiService, api } = setUp();
    await api.setEnabled(org, "d-1", false, password);
    expect(apiService.send).toHaveBeenCalledWith(
      "PUT",
      "/keykeeper/organizations/org-1/event-streaming/d-1",
      { enabled: false, masterPasswordHash: "server-hash" },
      true,
      true,
    );
  });

  it("makes a new signing secret with the proof as its body", async () => {
    const { apiService, api } = setUp();
    await api.newSecret(msp, "d-1", password);
    expect(apiService.send).toHaveBeenCalledWith(
      "POST",
      "/keykeeper/msp/msp-1/event-streaming/d-1/secret",
      { masterPasswordHash: "server-hash" },
      true,
      true,
    );
  });

  it("removes and tests one without any", async () => {
    const { apiService, api } = setUp();
    await api.remove(org, "d-1");
    await api.test(org, "d-1");
    expect(apiService.send).toHaveBeenNthCalledWith(
      1,
      "DELETE",
      "/keykeeper/organizations/org-1/event-streaming/d-1",
      null,
      true,
      false,
    );
    expect(apiService.send).toHaveBeenNthCalledWith(
      2,
      "POST",
      "/keykeeper/organizations/org-1/event-streaming/d-1/test",
      null,
      true,
      true,
    );
  });
});
