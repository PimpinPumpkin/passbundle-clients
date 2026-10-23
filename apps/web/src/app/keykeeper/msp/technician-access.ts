// Keykeeper: what an MSP technician gets in the MSP's clients, in words, and
// the choices the console offers. See DESIGN.md, "Roles and permissions".

import { ClientMspStaff } from "@bitwarden/admin-console/common";

import { CustomPermissions, TechnicianAccess } from "./msp-api.service";

/** Every client, as admin, with install commands: what a technician gets unless limited. */
export const DEFAULT_ACCESS: TechnicianAccess = {
  allClients: true,
  clients: [],
  custom: null,
  installCommands: true,
};

/** The custom role permissions the server enforces, with upstream's labels (i18n keys). */
export const PERMISSIONS: { key: keyof CustomPermissions; label: string }[] = [
  { key: "manageUsers", label: "manageUsers" },
  { key: "manageResetPassword", label: "manageAccountRecovery" },
  { key: "managePolicies", label: "managePolicies" },
  { key: "accessEventLogs", label: "accessEventLogs" },
  { key: "accessImportExport", label: "accessImportExport" },
];

export const NO_PERMISSIONS: CustomPermissions = {
  manageUsers: false,
  manageResetPassword: false,
  managePolicies: false,
  accessEventLogs: false,
  accessImportExport: false,
};

/** A technician's access in one line, for the staff table. */
export function describeAccess(
  access: TechnicianAccess,
  clients: { id: string; name: string }[],
): string {
  const names = access.clients
    .map((id) => clients.find((c) => c.id === id)?.name)
    .filter((name): name is string => name != null)
    .sort((a, b) => a.localeCompare(b));
  const reach = access.allClients
    ? "Every client"
    : names.length === 0
      ? "No clients"
      : names.join(", ");
  const role =
    access.custom == null
      ? "Admin"
      : access.custom.vaultItems
        ? "Custom role with every item"
        : "Custom role";
  const install = access.installCommands ? "Install commands" : "No install commands";
  const differing = (access.clientRoles ?? [])
    .map((r) => {
      const name = clients.find((c) => c.id === r.client)?.name;
      if (name == null) {
        return null;
      }
      const there =
        r.custom == null
          ? "Admin"
          : r.custom.vaultItems
            ? "Custom role with every item"
            : "Custom role";
      return `${there} in ${name}`;
    })
    .filter((words): words is string => words != null)
    .sort((a, b) => a.localeCompare(b));
  return [reach, role, install, ...differing].join(" · ");
}

/** Whether access reaches every client, for the toast after adding someone. */
export function reachesEveryClient(access: TechnicianAccess | undefined): boolean {
  return access == null || access.allClients;
}

/**
 * What one of the MSP's people can do in a client, for the client's own
 * owners and admins: their role, a custom role's permissions (upstream's
 * labels, through `t`), and whether they see vault items. Null when the
 * server didn't say.
 */
export function describeStaffRole(
  staff: ClientMspStaff,
  t: (key: string) => string,
): string | null {
  switch (staff.role) {
    case "owner":
      return "Owner, with every item";
    case "admin":
      return "Admin, with every item";
    case "custom": {
      const permissions = PERMISSIONS.filter((p) => staff.permissions?.includes(p.key))
        .map((p) => t(p.label))
        .join(", ");
      const items = staff.vaultItems ? "with every item" : "no items";
      return `Custom role (${permissions || "no permissions"}), ${items}`;
    }
    case "member":
      return staff.vaultItems ? "Member, with every item" : "Member, no items";
    default:
      return null;
  }
}
