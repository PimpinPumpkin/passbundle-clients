import {
  OrganizationUserStatusType,
  OrganizationUserType,
} from "@bitwarden/common/admin-console/enums";
import { PermissionsApi } from "@bitwarden/common/admin-console/models/api/permissions.api";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";

import { clientConsoleWay, noConsoleHelp } from "./client-console";
import { MspClient } from "./msp-api.service";

function client(vaultItems?: boolean): MspClient {
  return {
    id: "org-1",
    name: "Acme Dental",
    you: { memberId: "m-1", status: 2, type: 4, vaultItems },
  } as MspClient;
}

function organization(
  type: OrganizationUserType,
  permissions: Partial<PermissionsApi> = {},
  flags: { useEvents?: boolean } = {},
): Organization {
  const org = new Organization();
  org.id = "org-1";
  org.type = type;
  org.status = OrganizationUserStatusType.Confirmed;
  org.enabled = true;
  org.usePolicies = true;
  org.useEvents = flags.useEvents ?? true;
  org.permissions = Object.assign(new PermissionsApi(), permissions);
  return org;
}

describe("clientConsoleWay", () => {
  it("opens the admin console for owners, admins, and custom roles with something there", () => {
    expect(clientConsoleWay(client(), organization(OrganizationUserType.Owner))).toBe(
      "admin-console",
    );
    expect(clientConsoleWay(client(), organization(OrganizationUserType.Admin))).toBe(
      "admin-console",
    );
    for (const permission of [
      "manageUsers",
      "manageResetPassword",
      "managePolicies",
      "accessEventLogs",
      "accessImportExport",
    ] as const) {
      expect(
        clientConsoleWay(
          client(),
          organization(OrganizationUserType.Custom, { [permission]: true }),
        ),
      ).toBe("admin-console");
    }
  });

  it("keeps the admin console for a client not synced yet: its own guard decides", () => {
    expect(clientConsoleWay(client(), undefined)).toBe("admin-console");
  });

  it("offers a custom role with nothing in the admin console its items, or says so", () => {
    expect(clientConsoleWay(client(true), organization(OrganizationUserType.Custom))).toBe("items");
    expect(clientConsoleWay(client(false), organization(OrganizationUserType.Custom))).toBe("none");
    // Event logs alone, on a server with them turned off, open nothing there.
    expect(
      clientConsoleWay(
        client(false),
        organization(OrganizationUserType.Custom, { accessEventLogs: true }, { useEvents: false }),
      ),
    ).toBe("none");
  });

  it("says why, and what to do", () => {
    expect(noConsoleHelp(client(true))).toBe(
      "Your role in Acme Dental doesn't include its admin console. Its items are under Acme Dental in the menu.",
    );
    expect(noConsoleHelp(client(false))).toBe(
      "Your role in Acme Dental doesn't include its admin console or its items. An MSP admin can change your access.",
    );
  });
});
