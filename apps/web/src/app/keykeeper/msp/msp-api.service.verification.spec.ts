import { mock } from "jest-mock-extended";

import { SsoSettings } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { SyncService } from "@bitwarden/common/platform/sync";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, LegacyCompatKeyService } from "@bitwarden/legacy-crypto";

import { KeykeeperJoinSealer } from "../joining/join-sealer.service";

import { KeykeeperMspApiService } from "./msp-api.service";

const ORG = "11111111-2222-3333-4444-555555555555";

function setUp() {
  const apiService = mock<ApiService>();
  apiService.send.mockResolvedValue({});
  const api = new KeykeeperMspApiService(
    apiService,
    mock<AccountService>(),
    mock<LegacyCompatKeyService>(),
    mock<EncryptService>(),
    mock<I18nService>(),
    mock<SyncService>(),
    mock<KeykeeperJoinSealer>(),
  );
  return { apiService, api };
}

describe("provisioning and single sign-on requests with the person's proof", () => {
  it("makes the provisioning token with the master password hash as its body", async () => {
    const { apiService, api } = setUp();
    await api.makeProvisioningToken(ORG, { masterPasswordHash: "server-hash" });
    expect(apiService.send).toHaveBeenCalledWith(
      "POST",
      `/keykeeper/organizations/${ORG}/provisioning/token`,
      { masterPasswordHash: "server-hash" },
      true,
      true,
    );
  });

  it("makes it with a code, for an account without a master password", async () => {
    const { apiService, api } = setUp();
    await api.makeProvisioningToken(ORG, { otp: "123456" });
    expect(apiService.send.mock.calls[0][2]).toEqual({ otp: "123456" });
  });

  it("revokes it without any", async () => {
    const { apiService, api } = setUp();
    await api.revokeProvisioningToken(ORG);
    expect(apiService.send).toHaveBeenCalledWith(
      "DELETE",
      `/keykeeper/organizations/${ORG}/provisioning/token`,
      null,
      true,
      true,
    );
  });

  it("saves the single sign-on settings with the proof beside them", async () => {
    const { apiService, api } = setUp();
    const settings: SsoSettings = {
      enabled: true,
      identifier: "acme-dental",
      tenantId: "tenant",
      clientId: "client",
      clientSecret: null,
    };
    await api.saveSso(ORG, settings, { masterPasswordHash: "server-hash" });
    expect(apiService.send).toHaveBeenCalledWith(
      "PUT",
      `/keykeeper/organizations/${ORG}/sso`,
      { ...settings, masterPasswordHash: "server-hash" },
      true,
      true,
    );
  });
});

describe("two-step login settings with the person's proof", () => {
  it("turns an organization's two-step login for admins on or off with the proof beside it", async () => {
    const { apiService, api } = setUp();
    await api.setOrgAdminTwoStep(ORG, false, { masterPasswordHash: "server-hash" });
    expect(apiService.send).toHaveBeenCalledWith(
      "PUT",
      `/keykeeper/organizations/${ORG}/admin-two-step`,
      { required: false, masterPasswordHash: "server-hash" },
      true,
      true,
    );
  });

  it("turns the MSP's staff requirement on or off with a code", async () => {
    const { apiService, api } = setUp();
    await api.setMspStaffTwoStep(ORG, true, { otp: "123456" });
    expect(apiService.send).toHaveBeenCalledWith(
      "PUT",
      `/keykeeper/msp/${ORG}/two-step`,
      { staffRequired: true, otp: "123456" },
      true,
      true,
    );
  });
});
