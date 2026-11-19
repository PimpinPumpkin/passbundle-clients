import { FormBuilder } from "@angular/forms";

import { canAccessVaultTab } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationUserType } from "@bitwarden/common/admin-console/enums";
import { PermissionsApi } from "@bitwarden/common/admin-console/models/api/permissions.api";
import { CollectionAdminView } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";

import {
  CUSTOM_ROLE_PERMISSIONS,
  customRoleForm,
  customRolePermissions,
  customRoleValue,
} from "./custom-role";

const permissions = (p: Partial<PermissionsApi>) => Object.assign(new PermissionsApi(), p);

describe("Keykeeper custom role permissions", () => {
  it("offers each permission the server enforces once, by the name it reads", () => {
    const keys = CUSTOM_ROLE_PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(
      [
        "accessEventLogs",
        "accessImportExport",
        "accessReports",
        "keykeeperAccessAllItems",
        "keykeeperManageCollections",
        "manageGroups",
        "managePolicies",
        "manageResetPassword",
        "manageUsers",
      ].sort(),
    );
    const form = customRoleForm(new FormBuilder());
    expect(Object.keys(form.controls).sort()).toEqual(keys.sort());
    expect(Object.values(form.getRawValue()).every((v) => v === false)).toBe(true);
  });

  it("sends what's checked, managing shared folders as creating them, and never upstream's edit or delete any", () => {
    const sent = customRolePermissions({
      manageUsers: true,
      keykeeperManageCollections: true,
      keykeeperAccessAllItems: true,
    });
    expect(sent).toMatchObject({
      manageUsers: true,
      keykeeperManageCollections: true,
      keykeeperAccessAllItems: true,
      createNewCollections: true,
      editAnyCollection: false,
      deleteAnyCollection: false,
      manageGroups: false,
      accessReports: false,
      manageSso: false,
      manageScim: false,
    });
    expect(customRolePermissions({ manageGroups: true })).toMatchObject({
      manageGroups: true,
      createNewCollections: false,
    });
  });

  it("reads a member's permissions back as they were sent", () => {
    const checked = {
      manageUsers: true,
      manageResetPassword: false,
      manageGroups: true,
      keykeeperManageCollections: false,
      managePolicies: true,
      accessEventLogs: false,
      accessReports: true,
      accessImportExport: true,
      keykeeperAccessAllItems: true,
    };
    expect(customRoleValue(customRolePermissions(checked))).toEqual(checked);
    expect(customRoleValue(undefined).manageUsers).toBe(false);
  });

  it("shows upstream's Manage all collections as managing shared folders with access to all items", () => {
    const upstream = permissions({
      createNewCollections: true,
      editAnyCollection: true,
      deleteAnyCollection: true,
    });
    expect(customRoleValue(upstream)).toMatchObject({
      keykeeperManageCollections: true,
      keykeeperAccessAllItems: true,
    });
    // Creating alone isn't managing shared folders.
    expect(customRoleValue(permissions({ createNewCollections: true }))).toMatchObject({
      keykeeperManageCollections: false,
      keykeeperAccessAllItems: false,
    });
  });

  it("reads the server's keys from a member's permissions", () => {
    const read = new PermissionsApi({
      manageUsers: true,
      keykeeperManageCollections: true,
      keykeeperAccessAllItems: true,
    });
    expect(read.keykeeperManageCollections).toBe(true);
    expect(read.keykeeperAccessAllItems).toBe(true);
    expect(new PermissionsApi({ manageUsers: true }).keykeeperManageCollections).toBe(false);
  });
});

describe("Keykeeper: a custom role that manages shared folders, in the admin console", () => {
  const org = (type: OrganizationUserType, p: Partial<PermissionsApi>) =>
    Object.assign(new Organization(), {
      id: "org",
      type,
      enabled: true,
      permissions: permissions(p),
    });
  const folder = (assigned: boolean, grid: { delete: boolean }) =>
    Object.assign(
      new CollectionAdminView({ id: "f" as any, organizationId: "org" as any, name: "f" }),
      {
        assigned,
        readOnly: !grid.delete,
        keykeeper: {
          seePasswords: true,
          create: grid.delete,
          edit: grid.delete,
          delete: grid.delete,
          export: false,
          share: false,
          print: true,
          viewHistory: true,
          manage: false,
        },
      },
    );

  it("opens the Collections page, which other custom roles don't", () => {
    const manager = org(OrganizationUserType.Custom, { keykeeperManageCollections: true });
    expect(manager.keykeeperManagesCollections).toBe(true);
    expect(canAccessVaultTab(manager)).toBe(true);
    // Without editing every collection, so the page never loads every item.
    expect(manager.canEditAnyCollection).toBeFalsy();
    expect(manager.canEditAllCiphers).toBeFalsy();

    const members = org(OrganizationUserType.Custom, { manageUsers: true });
    expect(members.keykeeperManagesCollections).toBe(false);
    expect(canAccessVaultTab(members)).toBe(false);
    // Only a custom role's.
    expect(
      org(OrganizationUserType.User, { keykeeperManageCollections: true })
        .keykeeperManagesCollections,
    ).toBe(false);
  });

  it("edits the shared folders it reaches, and deletes those it can delete items in", () => {
    const manager = org(OrganizationUserType.Custom, { keykeeperManageCollections: true });
    expect(folder(true, { delete: false }).canEdit(manager)).toBe(true);
    expect(folder(true, { delete: false }).canDelete(manager)).toBe(false);
    expect(folder(true, { delete: true }).canDelete(manager)).toBe(true);
    expect(folder(false, { delete: true }).canEdit(manager)).toBe(false);
    expect(folder(false, { delete: true }).canDelete(manager)).toBe(false);

    const members = org(OrganizationUserType.Custom, { manageUsers: true });
    expect(folder(true, { delete: true }).canEdit(members)).toBe(false);
  });
});
