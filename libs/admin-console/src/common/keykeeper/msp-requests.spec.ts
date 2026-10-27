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
