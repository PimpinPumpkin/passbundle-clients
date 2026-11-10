import { ProductTierType } from "../../../billing/enums/product-tier-type.enum";
import { OrganizationUserStatusType, OrganizationUserType } from "../../enums";
import { ORGANIZATIONS } from "../../services/organization/organization.state";
import { Organization } from "../domain/organization";
import { ProfileOrganizationResponse } from "../response/profile-organization.response";

import { OrganizationData } from "./organization.data";

describe("ORGANIZATIONS state", () => {
  const sut = ORGANIZATIONS;

  it("should deserialize JSON string to proper object", async () => {
    const expectedResult: Record<string, OrganizationData> = {
      "1": {
        id: "id",
        name: "name",
        status: OrganizationUserStatusType.Invited,
        type: OrganizationUserType.Owner,
        enabled: false,
        usePolicies: false,
        useGroups: false,
        useDirectory: false,
        useEvents: false,
        useTotp: false,
        use2fa: false,
        useApi: false,
        useSso: false,
        useKeyConnector: false,
        useScim: false,
        useCustomPermissions: false,
        useResetPassword: false,
        useSecretsManager: false,
        usePasswordManager: false,
        usePam: false,
        useActivateAutofillPolicy: false,
        useAutomaticUserConfirmation: false,
        selfHost: false,
        usersGetPremium: false,
        seats: 0,
        maxCollections: 0,
        ssoBound: false,
        identifier: "identifier",
        permissions: undefined,
        resetPasswordEnrolled: false,
        userId: "userId",
        organizationUserId: "organizationUserId",
        hasPublicAndPrivateKeys: false,
        providerId: "providerId",
        providerName: "providerName",
        isProviderUser: false,
        isMember: false,
        familySponsorshipFriendlyName: "fsfn",
        familySponsorshipAvailable: false,
        productTierType: ProductTierType.Free,
        keyConnectorEnabled: false,
        keyConnectorUrl: "kcu",
        accessSecretsManager: false,
        limitCollectionCreation: false,
        limitCollectionDeletion: false,
        limitItemDeletion: false,
        allowAdminAccessToAllCollectionItems: false,
        familySponsorshipLastSyncDate: new Date(),
        userIsClaimedByOrganization: false,
        useAccessIntelligence: false,
        useOrganizationDomains: false,
        useAdminSponsoredFamilies: false,
        isAdminInitiated: false,
        ssoEnabled: false,
        ssoMemberDecryptionType: undefined,
        useDisableSMAdsForUsers: false,
        usePhishingBlocker: false,
        keykeeperPasswordChange: true,
        keykeeperBrowserAutofill: "off",
        keykeeperFromMsp: true,
        useMyItems: false,
        useInviteLinks: false,
      },
    };
    const result = sut.deserializer(JSON.parse(JSON.stringify(expectedResult)));
    expect(result).toEqual(expectedResult);
  });
});

// Keykeeper: the server says which memberships came from an MSP (DESIGN.md, "MSP console").
describe("a membership that came from an MSP", () => {
  function fromProfile(answer: Record<string, unknown>) {
    const data = new OrganizationData(new ProfileOrganizationResponse({ id: "org", ...answer }), {
      isMember: true,
      isProviderUser: false,
    });
    // The way it comes back out of the stored state.
    return new Organization(OrganizationData.fromJSON(JSON.parse(JSON.stringify(data))));
  }

  it("is known from the server's answer", () => {
    expect(fromProfile({ keykeeperFromMsp: true }).keykeeperFromMsp).toBe(true);
    expect(fromProfile({ keykeeperFromMsp: false }).keykeeperFromMsp).toBe(false);
  });

  it("is nobody on a server that doesn't say", () => {
    expect(fromProfile({}).keykeeperFromMsp).toBe(false);
  });

  it("takes nothing but a plain yes for one", () => {
    expect(fromProfile({ keykeeperFromMsp: "true" }).keykeeperFromMsp).toBe(false);
    expect(fromProfile({ keykeeperFromMsp: 1 }).keykeeperFromMsp).toBe(false);
    expect(fromProfile({ keykeeperFromMsp: null }).keykeeperFromMsp).toBe(false);
  });
});
