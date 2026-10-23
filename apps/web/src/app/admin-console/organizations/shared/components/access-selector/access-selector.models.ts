// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { OrganizationUserUserDetailsResponse } from "@bitwarden/admin-console/common";
import {
  OrganizationUserStatusType,
  OrganizationUserType,
} from "@bitwarden/common/admin-console/enums";
import {
  FOLDER_PRESETS,
  FolderGrid,
  gridOf,
  presetOf,
  upstreamOf,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { CollectionAccessSelectionView } from "@bitwarden/common/admin-console/models/collections";
import { SelectItemView } from "@bitwarden/components";

import { GroupView } from "../../../core";

/**
 * Permission options that replace/correspond with manage, readOnly, and hidePassword server fields.
 */
// FIXME: update to use a const object instead of a typescript enum
// eslint-disable-next-line @bitwarden/platform/no-enums
export enum CollectionPermission {
  View = "view",
  ViewExceptPass = "viewExceptPass",
  Edit = "edit",
  EditExceptPass = "editExceptPass",
  Manage = "manage",
  /** Keykeeper: any other grid of capabilities (DESIGN.md, "Folders and permissions"). */
  Custom = "custom",
}

// FIXME: update to use a const object instead of a typescript enum
// eslint-disable-next-line @bitwarden/platform/no-enums
export enum AccessItemType {
  Collection,
  Group,
  Member,
}

/**
 * A "generic" type that describes an item that can be selected from a
 * ng-select list and have its collection permission modified.
 *
 * Currently, it supports Collections, Groups, and Members. Members require some additional
 * details to render in the AccessSelectorComponent so their type is defined separately
 * and then joined back with the base type.
 *
 */
export type AccessItemView = SelectItemView & {
  /**
   * Flag that this item cannot be modified.
   * This will disable the permission editor and will keep
   * the item always selected.
   */
  readonly?: boolean;

  /**
   * Optional permission that will be rendered for this
   * item if it set to readonly.
   */
  readonlyPermission?: CollectionPermission;
} & (
    | {
        type: AccessItemType.Collection;
        viaGroupName?: string;
      }
    | {
        type: AccessItemType.Group;
      }
    | {
        type: AccessItemType.Member; // Members have a few extra details required to display, so they're added here
        email: string;
        role: OrganizationUserType;
        status: OrganizationUserStatusType;
      }
  );

/**
 * A type that is emitted as a value for the ngControl
 */
export type AccessItemValue = {
  id: string;
  permission?: CollectionPermission;
  type: AccessItemType;
  /**
   * Keykeeper: the grant's grid of capabilities. A preset's grid for the
   * presets; any grid for Custom. Missing means the permission's preset.
   */
  grid?: FolderGrid;
};

export type Permission = {
  perm: CollectionPermission;
  labelId: string;
  /**
   * VFO1 terminology feature flag variant of `labelId`. Falls back to `labelId` when not set.
   */
  vfo1LabelId?: string;
};

/**
 * Resolves the i18n label id to display for `permission`, honoring the VFO1 terminology
 * feature flag. Falls back to the legacy `labelId` when the permission has no `vfo1LabelId`
 * or `vfo1Enabled` is false. All consumers of `getPermissionList()` should render labels
 * through this helper so they stay consistent with each other.
 */
export const permissionLabelId = (
  permission: Permission | undefined,
  vfo1Enabled: boolean,
): string | undefined => {
  if (permission == null) {
    return undefined;
  }
  return vfo1Enabled ? (permission.vfo1LabelId ?? permission.labelId) : permission.labelId;
};

/**
 * Keykeeper: the access selector's choices: four presets and Custom, which
 * opens the grid. Upstream's "Can edit except passwords" is a Custom grid
 * now. See DESIGN.md, "Folders and permissions".
 */
export const getPermissionList = (): Permission[] => {
  const permissions = [
    { perm: CollectionPermission.View, labelId: "keykeeperCanView" },
    { perm: CollectionPermission.ViewExceptPass, labelId: "keykeeperCanViewHidden" },
    { perm: CollectionPermission.Edit, labelId: "keykeeperCanEdit" },
    { perm: CollectionPermission.Manage, labelId: "keykeeperCanManage" },
    { perm: CollectionPermission.Custom, labelId: "keykeeperCustomPermissions" },
  ];

  return permissions;
};

/** Keykeeper: each preset's permission, by the grid's preset name. */
const PRESET_PERMISSIONS = {
  view: CollectionPermission.View,
  viewHidden: CollectionPermission.ViewExceptPass,
  edit: CollectionPermission.Edit,
  manage: CollectionPermission.Manage,
  custom: CollectionPermission.Custom,
} as const;

/** Keykeeper: the grid a permission's preset gives, or undefined for Custom. */
export const presetGridFor = (perm: CollectionPermission | undefined): FolderGrid | undefined => {
  switch (perm) {
    case CollectionPermission.View:
      return { ...FOLDER_PRESETS.view };
    case CollectionPermission.ViewExceptPass:
      return { ...FOLDER_PRESETS.viewHidden };
    case CollectionPermission.Edit:
      return { ...FOLDER_PRESETS.edit };
    case CollectionPermission.Manage:
      return { ...FOLDER_PRESETS.manage };
    case CollectionPermission.EditExceptPass:
      return gridOf({ readOnly: false, hidePasswords: true, manage: false });
    default:
      return undefined;
  }
};

/** Keykeeper: a grant's grid, from what the server sent. */
export const convertToGrid = (
  value: CollectionAccessSelectionView | undefined,
): FolderGrid | undefined => (value == null ? undefined : gridOf(value));

/**
 * Converts the CollectionAccessSelectionView interface to one of the new CollectionPermission values
 * for the dropdown in the AccessSelectorComponent
 * @param value
 */
export const convertToPermission = (
  value: CollectionAccessSelectionView | undefined,
): CollectionPermission | undefined => {
  if (value == null) {
    return undefined;
  }
  // Keykeeper: the preset the grant's grid is, or Custom.
  return PRESET_PERMISSIONS[presetOf(gridOf(value))];
};

/**
 * Converts an AccessItemValue back into a CollectionAccessView class using the CollectionPermission
 * to determine the values for `manage`, `readOnly`, and `hidePassword`
 * @param value
 */
export const convertToSelectionView = (value: AccessItemValue) => {
  // Keykeeper: the grid decides; upstream's fields carry its closest preset.
  const grid = (value.permission === CollectionPermission.Custom ? value.grid : undefined) ??
    presetGridFor(value.permission) ??
    value.grid ?? { ...FOLDER_PRESETS.view };
  return new CollectionAccessSelectionView({
    id: value.id,
    ...upstreamOf(grid),
    keykeeper: grid,
  });
};

export function mapGroupToAccessItemView(group: GroupView): AccessItemView {
  return {
    id: group.id,
    type: AccessItemType.Group,
    listName: group.name,
    labelName: group.name,
  };
}

// TODO: Use view when user apis are migrated to a service
export function mapUserToAccessItemView(user: OrganizationUserUserDetailsResponse): AccessItemView {
  return {
    id: user.id,
    type: AccessItemType.Member,
    email: user.email,
    role: user.type,
    listName: user.name?.length > 0 ? `${user.name} (${user.email})` : user.email,
    labelName: user.name ?? user.email,
    status: user.status,
  };
}
