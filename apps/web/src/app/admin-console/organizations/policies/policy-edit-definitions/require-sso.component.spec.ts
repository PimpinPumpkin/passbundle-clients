import { mock } from "jest-mock-extended";
import { firstValueFrom } from "rxjs";

import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";

import { RequireSsoPolicy, RequireSsoPolicyComponent } from "./require-sso.component";

describe("RequireSsoPolicy", () => {
  const policy = new RequireSsoPolicy();

  it("should have correct attributes", () => {
    expect(policy.name).toBe("requireSsoPolicyTitle");
    expect(policy.description).toBe("requireSsoPolicyDescV2");
    expect(policy.prerequisiteKey).toBe("requireSsoPolicyReqV2");
    expect(policy.type).toBe(PolicyType.RequireSso);
    // Keykeeper: our own form, upstream's switch plus who isn't linked yet.
    expect(policy.component).toBe(RequireSsoPolicyComponent);
  });

  describe("display$", () => {
    it("should display for organizations with SSO entitlement", async () => {
      const org = { useSso: true } as Organization;

      const result = await firstValueFrom(policy.display$(org, mock<ConfigService>()));

      expect(result).toBe(true);
    });

    it("should not display for organizations without SSO entitlement", async () => {
      const org = { useSso: false } as Organization;

      const result = await firstValueFrom(policy.display$(org, mock<ConfigService>()));

      expect(result).toBe(false);
    });
  });
});
