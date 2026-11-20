import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import {
  OrganizationUserStatusType,
  OrganizationUserType,
} from "@bitwarden/common/admin-console/enums";
import {
  FOLDER_PRESETS,
  FolderGrid,
  GRID_ALL,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { PermissionsApi } from "@bitwarden/common/admin-console/models/api/permissions.api";
import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { OrganizationExportResponse } from "@bitwarden/common/admin-console/models/response/organization-export.response";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { CollectionId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { RestrictedItemTypesService } from "@bitwarden/common/vault/services/restricted-item-types.service";
import { KdfConfigService, KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, KeyGenerationService, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";
import {
  IndividualVaultExportServiceAbstraction,
  OrganizationVaultExportService,
  VaultExportApiService,
  VaultExportService,
} from "@bitwarden/vault-export-core";

import { Response } from "../models/response";
import { CliUtils } from "../utils";

import { ExportCommand } from "./export.command";

// Keykeeper: `export --organizationid`, by role (DESIGN.md, "Folders and
// permissions", B39). The whole organization comes from the server's export
// only for those it answers; everyone else exports the shared folders where
// their grid gives export, from their own synced items, and the server's
// export, which would refuse them (a regular member with 401, which signed
// the tool out), is never asked.

const userId = "user" as UserId;
const orgId = "11111111-1111-4111-8111-111111111111" as OrganizationId;

/** The organization's folders and items, as its owner sees them. */
const FOLDERS = ["Reports", "Payroll", "Domain admins", "Archive"] as const;
type Folder = (typeof FOLDERS)[number];
const ITEMS: Record<string, Folder[]> = {
  "Quarterly report": ["Reports"],
  "Shared drive": ["Reports", "Payroll"],
  "Payroll portal": ["Payroll"],
  "Domain admin": ["Domain admins"],
  "Old server": ["Archive"],
  // In no folder: only those who reach every item have it.
  "Retired router": [],
};
const EVERYTHING = Object.keys(ITEMS).sort();
const IN_FOLDERS = EVERYTHING.filter((name) => ITEMS[name].length > 0);
const REPORTS = ["Quarterly report", "Shared drive"];
const NOTHING = "You can't export any of this organization's shared folders.";

const VIEW_AND_EXPORT: FolderGrid = { ...FOLDER_PRESETS.view, export: true };
const EVERY_ITEM: FolderGrid = { ...GRID_ALL, manage: false };
/** What sync gives someone who reaches every folder, in each of them. */
const everyFolder = (grid: FolderGrid) =>
  Object.fromEntries(FOLDERS.map((f) => [f, grid])) as Partial<Record<Folder, FolderGrid>>;
/** A regular member's or limited custom role's folders: export in Reports, view in Payroll, passwords hidden in Domain admins, not Archive. */
const SOME_FOLDERS: Partial<Record<Folder, FolderGrid>> = {
  Reports: VIEW_AND_EXPORT,
  Payroll: FOLDER_PRESETS.view,
  "Domain admins": FOLDER_PRESETS.viewHidden,
};

type Role = {
  name: string;
  type: OrganizationUserType;
  permissions?: Record<string, boolean>;
  fromMsp?: boolean;
  /** Their grid in each folder they reach, as sync gives it. */
  folders: Partial<Record<Folder, FolderGrid>>;
  /** They reach every item, the one in no folder included. */
  everyItem: boolean;
  /** How the server's export answers them. */
  server: 200 | 400 | 401 | 404;
  /** The items their export holds, or why it's refused. */
  exports: string[] | string;
};

const ROLES: Role[] = [
  {
    name: "an owner",
    type: OrganizationUserType.Owner,
    folders: everyFolder(GRID_ALL),
    everyItem: true,
    server: 200,
    exports: EVERYTHING,
  },
  {
    name: "an admin",
    type: OrganizationUserType.Admin,
    folders: everyFolder(GRID_ALL),
    everyItem: true,
    server: 200,
    exports: EVERYTHING,
  },
  {
    name: "an MSP's technician who is an admin in the client",
    type: OrganizationUserType.Admin,
    fromMsp: true,
    folders: everyFolder(GRID_ALL),
    everyItem: true,
    server: 200,
    exports: EVERYTHING,
  },
  {
    name: "a custom role with import and export and access to all items",
    type: OrganizationUserType.Custom,
    permissions: { accessImportExport: true, keykeeperAccessAllItems: true },
    folders: everyFolder(EVERY_ITEM),
    everyItem: true,
    server: 200,
    exports: EVERYTHING,
  },
  {
    name: "an MSP's technician with a custom role with import and export and vault items",
    type: OrganizationUserType.Custom,
    permissions: { accessImportExport: true, keykeeperAccessAllItems: true },
    fromMsp: true,
    folders: everyFolder(EVERY_ITEM),
    everyItem: true,
    server: 200,
    exports: EVERYTHING,
  },
  {
    name: "a custom role with import and export, without access to all items",
    type: OrganizationUserType.Custom,
    permissions: { accessImportExport: true },
    folders: SOME_FOLDERS,
    everyItem: false,
    server: 400,
    exports: REPORTS,
  },
  {
    name: "a custom role with import and export that can export none of its folders",
    type: OrganizationUserType.Custom,
    permissions: { accessImportExport: true },
    folders: { Payroll: FOLDER_PRESETS.view },
    everyItem: false,
    server: 400,
    exports: NOTHING,
  },
  {
    // Every item but the one in no folder: the grid's export is per folder.
    name: "a custom role with access to all items, without import and export",
    type: OrganizationUserType.Custom,
    permissions: { keykeeperAccessAllItems: true },
    folders: everyFolder(EVERY_ITEM),
    everyItem: true,
    server: 404,
    exports: IN_FOLDERS,
  },
  {
    name: "an MSP's technician with a helpdesk role, given export in Reports",
    type: OrganizationUserType.Custom,
    permissions: { manageUsers: true, manageResetPassword: true },
    fromMsp: true,
    folders: SOME_FOLDERS,
    everyItem: false,
    server: 404,
    exports: REPORTS,
  },
  {
    name: "a member with export in some of her folders",
    type: OrganizationUserType.User,
    folders: SOME_FOLDERS,
    everyItem: false,
    server: 401,
    exports: REPORTS,
  },
  {
    name: "a member with export in every folder she reaches",
    type: OrganizationUserType.User,
    folders: { Reports: VIEW_AND_EXPORT },
    everyItem: false,
    server: 401,
    exports: REPORTS,
  },
  {
    name: "a member who can export none of her folders",
    type: OrganizationUserType.User,
    folders: { Payroll: FOLDER_PRESETS.view, "Domain admins": FOLDER_PRESETS.viewHidden },
    everyItem: false,
    server: 401,
    exports: NOTHING,
  },
];

const folderId = (name: string) =>
  `folder-${name.toLowerCase().replace(/\s+/g, "-")}` as CollectionId;

function item(name: string, collectionIds: string[]): CipherView {
  const view = new CipherView();
  view.id = name;
  view.name = name;
  view.type = CipherType.Login;
  view.organizationId = orgId;
  view.collectionIds = collectionIds;
  view.login = new LoginView();
  view.login.username = "someone";
  view.login.password = `${name} password`;
  return view;
}

describe("ExportCommand, an organization's export by role", () => {
  let cipherService: MockProxy<CipherService>;
  let collectionService: MockProxy<CollectionService>;
  let organizationService: MockProxy<OrganizationService>;
  let vaultExportApiService: MockProxy<VaultExportApiService>;
  let saved: string | undefined;
  let command: ExportCommand;

  /** Sets up what the server gives this role: their membership, sync, and the server's export's answer. */
  function as(role: Role) {
    const organization = Object.assign(new Organization(), {
      id: orgId,
      name: "Northwind Traders",
      type: role.type,
      status: OrganizationUserStatusType.Confirmed,
      enabled: true,
      isMember: true,
      keykeeperFromMsp: role.fromMsp === true,
      permissions: new PermissionsApi(role.permissions ?? {}),
    });
    organizationService.organizations$.mockReturnValue(of([organization]));

    const reached = new Set(Object.keys(role.folders));
    collectionService.decryptedCollections$.mockReturnValue(
      of(
        Object.entries(role.folders).map(([name, grid]) => {
          const view = new CollectionView({ id: folderId(name), organizationId: orgId, name });
          view.keykeeper = grid;
          view.readOnly = !grid.edit;
          view.hidePasswords = !grid.seePasswords;
          view.manage = grid.manage;
          return view;
        }),
      ),
    );
    // Sync: an item they reach, with the folders of it they reach.
    cipherService.getAllDecrypted.mockResolvedValue(
      Object.entries(ITEMS)
        .filter(([, folders]) => (role.everyItem ? true : folders.some((f) => reached.has(f))))
        .map(([name, folders]) => item(name, folders.filter((f) => reached.has(f)).map(folderId))),
    );

    if (role.server === 200) {
      vaultExportApiService.getOrganizationExport.mockResolvedValue(
        new OrganizationExportResponse({
          Collections: FOLDERS.map((name) => ({
            Id: folderId(name),
            OrganizationId: orgId,
            Name: name,
          })),
          Ciphers: Object.entries(ITEMS).map(([name, folders]) => ({
            Id: name,
            OrganizationId: orgId,
            Type: CipherType.Login,
            Name: name,
            Login: {},
            CollectionIds: folders.map(folderId),
            DeletedDate: null as string | null,
          })),
        }),
      );
    } else {
      vaultExportApiService.getOrganizationExport.mockRejectedValue(
        new ErrorResponse({ message: "refused" }, role.server),
      );
    }
  }

  beforeEach(() => {
    saved = undefined;
    cipherService = mock<CipherService>();
    cipherService.decrypt.mockImplementation(async (cipher: Cipher) =>
      item(cipher.id, cipher.collectionIds ?? []),
    );
    collectionService = mock<CollectionService>();
    organizationService = mock<OrganizationService>();
    vaultExportApiService = mock<VaultExportApiService>();

    const keyService = mock<KeyService>();
    keyService.orgKeys$.mockReturnValue(
      of({ [orgId]: new SymmetricCryptoKey(new Uint8Array(64)) } as never),
    );
    const encryptService = mock<EncryptService>();
    // Folder names come back as they went: the test's server sends them plain.
    encryptService.decryptString.mockImplementation(async (enc) => enc.encryptedString as string);
    const restricted = {
      restricted$: of([]),
      isCipherRestricted: () => false,
    } as unknown as RestrictedItemTypesService;
    const accountService = mockAccountServiceWith(userId);
    const exportService = new VaultExportService(
      mock<IndividualVaultExportServiceAbstraction>(),
      new OrganizationVaultExportService(
        cipherService,
        vaultExportApiService,
        mock<KeyGenerationService>(),
        keyService,
        encryptService,
        collectionService,
        mock<KdfConfigService>(),
        restricted,
      ),
      accountService,
    );
    const policyService = mock<PolicyService>();
    policyService.policyAppliesToUser$.mockReturnValue(of(false));

    jest.spyOn(CliUtils, "saveResultToFile").mockImplementation(async (data) => {
      saved = data as string;
      return Response.success();
    });

    command = new ExportCommand(
      exportService,
      policyService,
      mock<EventCollectionService>(),
      accountService,
      organizationService,
      cipherService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(ROLES)("$name: $exports", async (role) => {
    as(role);

    const response = await command.run({ organizationid: orgId, format: "json" });

    // The server's export only for those it answers.
    if (role.server === 200) {
      expect(vaultExportApiService.getOrganizationExport).toHaveBeenCalledWith(orgId);
    } else {
      expect(vaultExportApiService.getOrganizationExport).not.toHaveBeenCalled();
    }
    if (typeof role.exports === "string") {
      expect(response.success).toBe(false);
      expect(response.message).toContain(role.exports);
      expect(saved).toBeUndefined();
      return;
    }
    expect(response.message).toBeUndefined();
    expect(response.success).toBe(true);
    const doc = JSON.parse(saved!);
    expect(doc.items.map((i: { name: string }) => i.name).sort()).toEqual(role.exports);
    // With their passwords: export needs see passwords in the same folder.
    for (const exported of doc.items) {
      expect(exported.login.password).toBe(`${exported.name} password`);
    }
    // The folders that go are the ones they can export.
    const folders = doc.collections.map((c: { name: string }) => c.name).sort();
    if (role.server === 200) {
      expect(folders).toEqual([...FOLDERS].sort());
    } else {
      expect(folders).toEqual(
        Object.entries(role.folders)
          .filter(([, grid]) => grid.export)
          .map(([name]) => name)
          .sort(),
      );
    }
  });
});
