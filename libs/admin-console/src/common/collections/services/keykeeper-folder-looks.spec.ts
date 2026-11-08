// Keykeeper: a shared folder's icon and color (DESIGN.md, "Folder icons"),
// encrypted with its organization's key as its name is: opened beside the
// name wherever the apps open folders, and saved through our endpoint.
import { mock, MockProxy } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom, of } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import {
  Collection,
  CollectionAccessDetailsResponse,
  CollectionAdminView,
  CollectionData,
  CollectionView,
} from "@bitwarden/common/admin-console/models/collections";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { FakeStateProvider, makeEncString, mockAccountServiceWith } from "@bitwarden/common/spec";
import { CollectionId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString, SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import { CollectionEncryptionService } from "../abstractions/collection-encryption.service";
import { CollectionService } from "../abstractions/collection.service";

import { ENCRYPTED_COLLECTION_DATA_KEY } from "./collection.state";
import { DefaultCollectionAdminService } from "./default-collection-admin.service";
import { DefaultCollectionService } from "./default-collection.service";

const ORG = Utils.newGuid() as OrganizationId;
const OTHER_ORG = Utils.newGuid() as OrganizationId;
const orgKey = new SymmetricCryptoKey(new Uint8Array(64).fill(1)) as OrgKey;
const otherKey = new SymmetricCryptoKey(new Uint8Array(64).fill(2)) as OrgKey;

/** Stand-in encryption: "LOOK:<text>" opens to <text>, with its organization's key only. */
function encryption(): MockProxy<EncryptService> {
  const encryptService = mock<EncryptService>();
  encryptService.decryptString.mockImplementation(async (enc: EncString, key) => {
    if (enc.data?.startsWith("LOOK:") && key === orgKey) {
      return enc.data.slice("LOOK:".length);
    }
    throw new Error("doesn't open");
  });
  encryptService.encryptString.mockImplementation(async (text: string) =>
    makeEncString(`SEALED:${text}`),
  );
  return encryptService;
}

function collectionData(id: string, look?: string, org = ORG): CollectionData {
  const data = new CollectionData({} as never);
  data.id = id as CollectionId;
  data.organizationId = org;
  data.name = makeEncString(`name-${id}`).encryptedString!;
  if (look) {
    data.keykeeperLook = makeEncString(look).encryptedString!;
  }
  return data;
}

describe("shared folders' icons", () => {
  let userId: UserId;
  let encryptService: MockProxy<EncryptService>;
  let keyService: MockProxy<KeyService>;
  let stateProvider: FakeStateProvider;
  let collectionEncryptionService: MockProxy<CollectionEncryptionService>;
  let collectionService: DefaultCollectionService;

  beforeEach(() => {
    userId = Utils.newGuid() as UserId;
    encryptService = encryption();
    keyService = mock<KeyService>();
    keyService.orgKeys$.mockReturnValue(
      new BehaviorSubject({ [ORG]: orgKey, [OTHER_ORG]: otherKey } as Record<
        OrganizationId,
        OrgKey
      >),
    );
    stateProvider = new FakeStateProvider(mockAccountServiceWith(userId));
    // The SDK opens the names and knows nothing of the look.
    collectionEncryptionService = mock<CollectionEncryptionService>();
    collectionEncryptionService.decryptMany.mockImplementation((collections: Collection[]) =>
      of(
        collections.map(
          (c) => new CollectionView({ id: c.id, organizationId: c.organizationId, name: c.id }),
        ),
      ),
    );
    const i18nService = mock<I18nService>();
    i18nService.collator = null as never;
    collectionService = new DefaultCollectionService(
      keyService,
      encryptService,
      i18nService,
      stateProvider,
      collectionEncryptionService,
      mock<LogService>({ startMeasurement: () => ({ finish: () => {} }) as never }),
    );
  });

  it("opens each folder's look with its organization's key, beside the name", async () => {
    await stateProvider.setUserState(
      ENCRYPTED_COLLECTION_DATA_KEY,
      Object.fromEntries(
        [
          collectionData("banking", 'LOOK:{"icon":"bank","tone":"emerald"}'),
          collectionData("plain"),
          collectionData("broken", "not a look"),
          // Under another organization's key, which this one isn't.
          collectionData("elsewhere", 'LOOK:{"icon":"bank","tone":"emerald"}', OTHER_ORG),
        ].map((c) => [c.id, c]),
      ),
      userId,
    );

    const views = await firstValueFrom(collectionService.decryptedCollections$(userId));
    const look = (id: string) => views.find((v) => v.id === id)?.keykeeperLook;

    expect(look("banking")).toEqual({ icon: "bank", tone: "emerald" });
    expect(look("plain")).toBeUndefined();
    expect(look("broken")).toBeUndefined();
    expect(look("elsewhere")).toBeUndefined();
    expect(views.map((v) => v.id).sort()).toEqual(["banking", "broken", "elsewhere", "plain"]);
    // Only folders with a look are opened for one.
    expect(encryptService.decryptString).toHaveBeenCalledTimes(3);
  });

  it("opens the look of a folder saved since", async () => {
    await stateProvider.setUserState(ENCRYPTED_COLLECTION_DATA_KEY, {}, userId);
    await collectionService.upsert(
      collectionData("servers", 'LOOK:{"icon":"server","tone":"garnet"}'),
      userId,
    );
    const views = await firstValueFrom(collectionService.decryptedCollections$(userId));
    expect(views.find((v) => v.id === "servers")?.keykeeperLook).toEqual({
      icon: "server",
      tone: "garnet",
    });
  });

  it("opens the look in the admin console's folders too", async () => {
    const response = new CollectionAccessDetailsResponse({
      id: "banking",
      organizationId: ORG,
      name: makeEncString("name").encryptedString,
      keykeeperLook: makeEncString('LOOK:{"icon":"bank","tone":"gold"}').encryptedString,
      groups: [],
      users: [],
    });
    encryptService.decryptString.mockImplementationOnce(async () => "Banking");
    const view = await CollectionAdminView.fromCollectionAccessDetails(
      response,
      encryptService,
      orgKey,
    );
    expect(view.name).toBe("Banking");
    expect(view.keykeeperLook).toEqual({ icon: "bank", tone: "gold" });
    expect(new CollectionData(response).keykeeperLook).toBe(response.keykeeperLook);
  });

  describe("setting one", () => {
    let apiService: MockProxy<ApiService>;
    let ownCollections: MockProxy<CollectionService>;
    let adminService: DefaultCollectionAdminService;

    beforeEach(() => {
      apiService = mock<ApiService>();
      apiService.send.mockImplementation(async (_method, _path, body: any) => ({
        id: "banking",
        organizationId: ORG,
        name: "2.bmFtZQ==|bmFtZQ==|bmFtZQ==",
        keykeeperLook: body.look,
        object: "collectionDetails",
      }));
      ownCollections = mock<CollectionService>();
      adminService = new DefaultCollectionAdminService(
        apiService,
        keyService,
        encryptService,
        ownCollections,
        mock<OrganizationService>(),
      );
    });

    it("sends it encrypted with the organization's key, and updates the person's own copy", async () => {
      ownCollections.encryptedCollections$.mockReturnValue(
        of([Collection.fromCollectionData(collectionData("banking"))]),
      );

      await adminService.setLook(
        ORG,
        "banking" as CollectionId,
        { icon: "bank", tone: "emerald" },
        userId,
      );

      expect(encryptService.encryptString).toHaveBeenCalledWith(
        '{"icon":"bank","tone":"emerald"}',
        orgKey,
      );
      const sealed = makeEncString('SEALED:{"icon":"bank","tone":"emerald"}').encryptedString;
      expect(apiService.send).toHaveBeenCalledWith(
        "PUT",
        `/keykeeper/organizations/${ORG}/collections/banking/look`,
        { look: sealed },
        true,
        true,
      );
      expect(ownCollections.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "banking", keykeeperLook: sealed }),
        userId,
      );
    });

    it("clears it with null, and leaves alone a folder the person doesn't have", async () => {
      ownCollections.encryptedCollections$.mockReturnValue(of([]));

      await adminService.setLook(ORG, "banking" as CollectionId, null, userId);

      expect(encryptService.encryptString).not.toHaveBeenCalled();
      expect(apiService.send).toHaveBeenCalledWith(
        "PUT",
        `/keykeeper/organizations/${ORG}/collections/banking/look`,
        { look: null },
        true,
        true,
      );
      expect(ownCollections.upsert).not.toHaveBeenCalled();
    });
  });
});
