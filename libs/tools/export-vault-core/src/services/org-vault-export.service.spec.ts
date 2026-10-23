import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import {
  FOLDER_PRESETS,
  FolderGrid,
  GRID_ALL,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { KeyGenerationService } from "@bitwarden/common/key-management/crypto";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { CollectionId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { RestrictedItemTypesService } from "@bitwarden/common/vault/services/restricted-item-types.service";
import { KdfConfigService, KeyService } from "@bitwarden/key-management";

import { VaultExportApiService } from "./api/vault-export-api.service.abstraction";
import { OrganizationVaultExportService } from "./org-vault-export.service";

// Keykeeper: export is one of the capabilities the apps enforce (DESIGN.md,
// "Folders and permissions"): only items in shared folders the person can
// export leave in an export.
const userId = "user" as UserId;
const org = "org" as OrganizationId;

function folder(id: string, grid: FolderGrid): CollectionView {
  const view = new CollectionView({ id: id as CollectionId, organizationId: org, name: id });
  view.keykeeper = grid;
  view.readOnly = !grid.edit;
  view.hidePasswords = !grid.seePasswords;
  view.manage = grid.manage;
  return view;
}

function login(name: string, folderId: string): CipherView {
  const cipher = new CipherView();
  cipher.id = name;
  cipher.name = name;
  cipher.type = CipherType.Login;
  cipher.organizationId = org;
  cipher.collectionIds = [folderId];
  cipher.login = new LoginView();
  return cipher;
}

describe("OrganizationVaultExportService and shared folder permissions", () => {
  let collectionService: MockProxy<CollectionService>;
  let cipherService: MockProxy<CipherService>;
  let service: OrganizationVaultExportService;

  beforeEach(() => {
    collectionService = mock<CollectionService>();
    cipherService = mock<CipherService>();
    const restricted = {
      restricted$: of([]),
      isCipherRestricted: () => false,
    } as unknown as RestrictedItemTypesService;
    service = new OrganizationVaultExportService(
      cipherService,
      mock<VaultExportApiService>(),
      mock<KeyGenerationService>(),
      mock<KeyService>(),
      mock<EncryptService>(),
      collectionService,
      mock<KdfConfigService>(),
      restricted,
    );
  });

  it("exports only the items in folders the person can export", async () => {
    collectionService.decryptedCollections$.mockReturnValue(
      of([
        folder("reports", { ...FOLDER_PRESETS.view, export: true }),
        folder("payroll", FOLDER_PRESETS.edit),
      ]),
    );
    cipherService.getAllDecrypted.mockResolvedValue([
      login("Quarterly report", "reports"),
      login("Payroll portal", "payroll"),
    ]);

    const exported = await service.getOrganizationExport(userId, org, "json", true);
    const doc = JSON.parse(exported.data as string);

    expect(doc.collections.map((c: { name: string }) => c.name)).toEqual(["reports"]);
    expect(doc.items.map((i: { name: string }) => i.name)).toEqual(["Quarterly report"]);
  });

  it("refuses the whole organization's export to someone with a folder they can't export", async () => {
    collectionService.decryptedCollections$.mockReturnValue(
      of([folder("everyone", GRID_ALL), folder("payroll", FOLDER_PRESETS.edit)]),
    );

    await expect(service.getOrganizationExport(userId, org, "json", false)).rejects.toThrow(
      "You can't export some of this organization's shared folders.",
    );
  });
});
