import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { SecretVerificationRequest } from "@bitwarden/common/auth/models/request/secret-verification.request";

import { KeykeeperMspRequests, verificationFields } from "./msp-requests";
import { NewScriptToken } from "./msp-types";

const ORG = "11111111-2222-3333-4444-555555555555";
const TOKEN = "66666666-7777-8888-9999-000000000000";
const ITEM = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const token: NewScriptToken = {
  id: TOKEN,
  name: "Join domain",
  expiresAt: "2027-01-01T00:00:00Z",
  networks: [],
  authHash: "auth-hash",
  sealedKey: "2.sealed-key",
  grants: [{ itemId: ITEM, copy: "2.copy", revision: "r1", sealedSpec: "2.spec" }],
};
const grant = { copy: "2.copy", revision: "r2", sealedSpec: "2.spec" };

describe("the proof a sensitive change carries", () => {
  it("is the master password hash, without upstream's other fields", () => {
    const request = new SecretVerificationRequest();
    request.masterPasswordHash = "server-hash";
    request.authRequestAccessCode = "not-ours";
    expect(verificationFields(request)).toEqual({ masterPasswordHash: "server-hash" });
  });

  it("is the code, for an account without a master password", () => {
    const request = new SecretVerificationRequest();
    request.otp = "123456";
    expect(verificationFields(request)).toEqual({ otp: "123456" });
  });
});

describe("script token requests", () => {
  const setUp = () => {
    const apiService = mock<ApiService>();
    apiService.send.mockResolvedValue({});
    return { apiService, requests: new KeykeeperMspRequests(apiService) };
  };

  it("makes a token with the token's fields and the person's master password hash", async () => {
    const { apiService, requests } = setUp();
    await requests.createScriptToken(ORG, token, { masterPasswordHash: "server-hash" });
    expect(apiService.send).toHaveBeenCalledWith(
      "POST",
      `/keykeeper/organizations/${ORG}/script-tokens`,
      { ...token, masterPasswordHash: "server-hash" },
      true,
      true,
    );
  });

  it("makes a token with a code instead, for an account without a master password", async () => {
    const { apiService, requests } = setUp();
    await requests.createScriptToken(ORG, token, { otp: "123456" });
    const body = apiService.send.mock.calls[0][2];
    expect(body).toEqual({ ...token, otp: "123456" });
    expect(body).not.toHaveProperty("masterPasswordHash");
  });

  it("refreshes a copy without any proof, as apps do in the background", async () => {
    const { apiService, requests } = setUp();
    await requests.setScriptGrant(ORG, TOKEN, ITEM, grant);
    expect(apiService.send).toHaveBeenCalledWith(
      "PUT",
      `/keykeeper/organizations/${ORG}/script-tokens/${TOKEN}/grants/${ITEM}`,
      grant,
      true,
      true,
    );
  });

  it("adds an item with the person's proof", async () => {
    const { apiService, requests } = setUp();
    await requests.setScriptGrant(ORG, TOKEN, ITEM, grant, { masterPasswordHash: "server-hash" });
    expect(apiService.send.mock.calls[0][2]).toEqual({
      ...grant,
      masterPasswordHash: "server-hash",
    });
  });
});

describe("the nudges about two-step login", () => {
  const setUp = () => {
    const apiService = mock<ApiService>();
    return { apiService, requests: new KeykeeperMspRequests(apiService) };
  };

  it("shows the nudge the server names", async () => {
    const { apiService, requests } = setUp();
    apiService.send.mockResolvedValueOnce({ show: true, nudge: "setUp" });
    expect(await requests.twoStepNudge()).toBe("setUp");
    expect(apiService.send).toHaveBeenCalledWith(
      "GET",
      "/keykeeper/two-step-nudge",
      null,
      true,
      true,
    );
    // Email codes alone: `show` stays false for clients from before it.
    apiService.send.mockResolvedValueOnce({ show: false, nudge: "stronger" });
    expect(await requests.twoStepNudge()).toBe("stronger");
    apiService.send.mockResolvedValueOnce({ show: false, nudge: null });
    expect(await requests.twoStepNudge()).toBeNull();
  });

  it("takes an older server's show as the first nudge, and shows nothing it doesn't know", async () => {
    const { apiService, requests } = setUp();
    apiService.send.mockResolvedValueOnce({ show: true });
    expect(await requests.twoStepNudge()).toBe("setUp");
    apiService.send.mockResolvedValueOnce({ show: false });
    expect(await requests.twoStepNudge()).toBeNull();
    // An older server answers something else.
    apiService.send.mockResolvedValueOnce(null);
    expect(await requests.twoStepNudge()).toBeNull();
    // A nudge from a newer server that this doesn't know.
    apiService.send.mockResolvedValueOnce({ show: true, nudge: "somethingNew" });
    expect(await requests.twoStepNudge()).toBeNull();
  });

  it("never shows when the server can't be asked", async () => {
    const { apiService, requests } = setUp();
    apiService.send.mockRejectedValueOnce(new Error("offline"));
    expect(await requests.twoStepNudge()).toBeNull();
  });

  it("is dismissed on the server, for every device", async () => {
    const { apiService, requests } = setUp();
    apiService.send.mockResolvedValueOnce({ show: false, nudge: null });
    await requests.dismissTwoStepNudge();
    expect(apiService.send).toHaveBeenCalledWith(
      "POST",
      "/keykeeper/two-step-nudge/dismiss",
      null,
      true,
      true,
    );
  });
});

describe("confirming someone on its own", () => {
  it("is upstream's confirm with upstream's request, saying the app did it on its own", async () => {
    const apiService = mock<ApiService>();
    const requests = new KeykeeperMspRequests(apiService);
    await requests.confirmOnItsOwn(ORG, "member-1", {
      key: "4.org-key-for-member",
      defaultUserCollectionName: undefined,
    });
    expect(apiService.send).toHaveBeenCalledWith(
      "POST",
      `/organizations/${ORG}/users/member-1/confirm`,
      {
        key: "4.org-key-for-member",
        defaultUserCollectionName: undefined,
        keykeeperAutomatic: true,
      },
      true,
      false,
    );
  });
});

describe("reading whether someone is confirmed now", () => {
  const setUp = () => {
    const apiService = mock<ApiService>();
    return { apiService, requests: new KeykeeperMspRequests(apiService) };
  };

  it("asks the server fresh for that member, with upstream's request for one member's details", async () => {
    const { apiService, requests } = setUp();
    apiService.send.mockResolvedValue({ id: "member-1", status: 2 });
    expect(await requests.isConfirmed(ORG, "member-1")).toBe(true);
    expect(apiService.send).toHaveBeenCalledWith(
      "GET",
      `/organizations/${ORG}/users/member-1`,
      null,
      true,
      true,
    );
  });

  it("is no for anyone invited, waiting for the key, or revoked, or an answer without a status", async () => {
    const { apiService, requests } = setUp();
    for (const answer of [{ status: 0 }, { status: 1 }, { status: -1 }, {}, null]) {
      apiService.send.mockResolvedValueOnce(answer);
      expect(await requests.isConfirmed(ORG, "member-1")).toBe(false);
    }
  });

  it("is no when the server can't be asked or refuses", async () => {
    const { apiService, requests } = setUp();
    apiService.send.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await requests.isConfirmed(ORG, "member-1")).toBe(false);
    apiService.send.mockRejectedValueOnce(new Error("The specified user isn't a member"));
    expect(await requests.isConfirmed(ORG, "member-1")).toBe(false);
  });
});
