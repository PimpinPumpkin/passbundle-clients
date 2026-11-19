import { FormBuilder, FormControl, FormGroup } from "@angular/forms";

import { PermissionsApi } from "@bitwarden/common/admin-console/models/api/permissions.api";

/**
 * Keykeeper: the permissions a custom role can have, each of which our server
 * enforces (passbundle-server, `keykeeper_roles.rs`), in the order the member
 * dialogs offer them, by the name the server reads. They combine freely: a
 * page a role doesn't cover isn't shown to it, and the server answers "You
 * can't do that here." rather than signing anyone out (DESIGN.md, "Roles and
 * permissions").
 *
 * Upstream's "Manage all collections" isn't offered: it reaches every
 * collection, which a custom role's limits don't allow. Managing shared
 * folders, and access to all items, are ours instead.
 */
export const CUSTOM_ROLE_PERMISSIONS = [
  { key: "manageUsers", label: "manageUsers" },
  {
    key: "manageResetPassword",
    label: "manageAccountRecovery",
    hint: "keykeeperManageAccountRecoveryHint",
  },
  { key: "manageGroups", label: "manageGroups", hint: "keykeeperManageGroupsHint" },
  {
    key: "keykeeperManageCollections",
    label: "keykeeperManageSharedFolders",
    hint: "keykeeperManageSharedFoldersHint",
  },
  { key: "managePolicies", label: "managePolicies" },
  { key: "accessEventLogs", label: "accessEventLogs" },
  { key: "accessReports", label: "accessReports", hint: "keykeeperAccessReportsHint" },
  { key: "accessImportExport", label: "accessImportExport", hint: "keykeeperImportExportHint" },
  {
    key: "keykeeperAccessAllItems",
    label: "keykeeperAccessAllItems",
    hint: "keykeeperAccessAllItemsHint",
  },
] as const;

export type CustomRolePermission = (typeof CUSTOM_ROLE_PERMISSIONS)[number]["key"];

export type CustomRoleForm = FormGroup<Record<CustomRolePermission, FormControl<boolean>>>;

/** The member dialogs' custom role checkboxes, all unchecked. */
export function customRoleForm(formBuilder: FormBuilder): CustomRoleForm {
  const controls = Object.fromEntries(
    CUSTOM_ROLE_PERMISSIONS.map(({ key }) => [key, formBuilder.nonNullable.control(false)]),
  ) as Record<CustomRolePermission, FormControl<boolean>>;
  return formBuilder.group(controls);
}

/**
 * The checkboxes for a member's permissions as the server sends them.
 * Upstream's Custom with "Manage all collections" (all three of its
 * permissions) shows as what's closest: managing shared folders, with access
 * to all items. Saved from here, it becomes that.
 */
export function customRoleValue(
  permissions: PermissionsApi | undefined,
): Record<CustomRolePermission, boolean> {
  const p = (permissions ?? {}) as Partial<PermissionsApi>;
  const allCollections = !!(p.createNewCollections && p.editAnyCollection && p.deleteAnyCollection);
  return {
    manageUsers: !!p.manageUsers,
    manageResetPassword: !!p.manageResetPassword,
    manageGroups: !!p.manageGroups,
    keykeeperManageCollections: !!p.keykeeperManageCollections || allCollections,
    managePolicies: !!p.managePolicies,
    accessEventLogs: !!p.accessEventLogs,
    accessReports: !!p.accessReports,
    accessImportExport: !!p.accessImportExport,
    keykeeperAccessAllItems: !!p.keykeeperAccessAllItems || allCollections,
  };
}

/**
 * What a member dialog sends for a custom role: our permissions as checked,
 * and never upstream's "Manage all collections". Managing shared folders also
 * says "create new collections", as the server shows it.
 */
export function customRolePermissions(
  value: Partial<Record<CustomRolePermission, boolean>>,
): PermissionsApi {
  const checked = (key: CustomRolePermission) => value[key] === true;
  return Object.assign(new PermissionsApi(), {
    manageUsers: checked("manageUsers"),
    manageResetPassword: checked("manageResetPassword"),
    manageGroups: checked("manageGroups"),
    keykeeperManageCollections: checked("keykeeperManageCollections"),
    managePolicies: checked("managePolicies"),
    accessEventLogs: checked("accessEventLogs"),
    accessReports: checked("accessReports"),
    accessImportExport: checked("accessImportExport"),
    keykeeperAccessAllItems: checked("keykeeperAccessAllItems"),
    createNewCollections: checked("keykeeperManageCollections"),
    editAnyCollection: false,
    deleteAnyCollection: false,
    manageSso: false,
    manageScim: false,
  });
}
