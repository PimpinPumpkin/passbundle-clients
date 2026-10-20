import { Unassigned } from "@bitwarden/common/admin-console/models/collections";
import { CollectionId, OrganizationId } from "@bitwarden/common/types/guid";
import { CipherType } from "@bitwarden/common/vault/enums";
import { TEMPLATE_DEFINITION_FIELD_NAME } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { createFilterFunction } from "./filter-function";
import { All } from "./routed-vault-filter.model";

describe("createFilter", () => {
  describe("given a generic cipher", () => {
    it("should return true when no filter is applied", () => {
      const cipher = createCipher();
      const filterFunction = createFilterFunction({});

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });
  });

  describe("given a favorite cipher", () => {
    const cipher = createCipher({ favorite: true });

    it("should return true when filtering for favorites", () => {
      const filterFunction = createFilterFunction({ type: "favorites" });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return false when filtering for trash", () => {
      const filterFunction = createFilterFunction({ type: "trash" });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });
  });

  describe("given a deleted cipher", () => {
    const cipher = createCipher({ deletedDate: new Date() });

    it("should return true when filtering for trash", () => {
      const filterFunction = createFilterFunction({ type: "trash" });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return false when filtering for favorites", () => {
      const filterFunction = createFilterFunction({ type: "favorites" });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });

    it("should return false when type is not specified in filter", () => {
      const filterFunction = createFilterFunction({});

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });
  });

  describe("given a cipher with type", () => {
    it("should return true when filter matches cipher type", () => {
      const cipher = createCipher({ type: CipherType.Identity });
      const filterFunction = createFilterFunction({ type: "identity" });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return false when filter does not match cipher type", () => {
      const cipher = createCipher({ type: CipherType.Card });
      const filterFunction = createFilterFunction({ type: "favorites" });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });

    it("should return true when filtering for driversLicense", () => {
      const cipher = createCipher({ type: CipherType.DriversLicense });
      const filterFunction = createFilterFunction({ type: "driversLicense" });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return true when filter matches passport cipher type", () => {
      const cipher = createCipher({ type: CipherType.Passport });
      const filterFunction = createFilterFunction({ type: "passport" });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return false when passport cipher does not match filter type", () => {
      const cipher = createCipher({ type: CipherType.Passport });
      const filterFunction = createFilterFunction({ type: "identity" });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });

    it("should return false when filter is driversLicense but cipher is a different type", () => {
      const cipher = createCipher({ type: CipherType.Login });
      const filterFunction = createFilterFunction({ type: "driversLicense" });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });
  });

  describe("given a cipher with folder id", () => {
    it("should return true when filter matches folder id", () => {
      const cipher = createCipher({ folderId: "folderId" });
      const filterFunction = createFilterFunction({ folderId: "folderId" });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return false when filter does not match folder id", () => {
      const cipher = createCipher({ folderId: "folderId" });
      const filterFunction = createFilterFunction({ folderId: "differentFolderId" });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });
  });

  describe("given a cipher without folder", () => {
    const cipher = createCipher({ folderId: null });

    it("should return true when filtering on unassigned folder", () => {
      const filterFunction = createFilterFunction({ folderId: Unassigned });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return true when filtering on empty-string folder id", () => {
      const filterFunction = createFilterFunction({ folderId: "" });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });
  });

  describe("given an organizational cipher (with organization and collections)", () => {
    const cipher = createCipher({
      organizationId: "organizationId",
      collectionIds: ["collectionId", "anotherId"],
    });

    it("should return true when filter matches collection id", () => {
      const filterFunction = createFilterFunction({
        collectionId: "collectionId" as CollectionId,
        organizationId: "organizationId" as OrganizationId,
      });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return false when filter does not match collection id", () => {
      const filterFunction = createFilterFunction({
        collectionId: "nonMatchingCollectionId" as CollectionId,
        organizationId: "organizationId" as OrganizationId,
      });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });

    it("should return false when filter does not match organization id", () => {
      const filterFunction = createFilterFunction({
        organizationId: "nonMatchingOrganizationId" as OrganizationId,
      });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });

    it("should return false when filtering for my vault only", () => {
      const filterFunction = createFilterFunction({ organizationId: Unassigned });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });

    it("should return false when filtering by All Collections", () => {
      const filterFunction = createFilterFunction({ collectionId: All });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });
  });

  describe("given an unassigned organizational cipher (with organization, without collection)", () => {
    const cipher = createCipher({ organizationId: "organizationId", collectionIds: [] });

    it("should return true when filtering for unassigned collection", () => {
      const filterFunction = createFilterFunction({ collectionId: Unassigned });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });

    it("should return true when filter matches organization id", () => {
      const filterFunction = createFilterFunction({
        organizationId: "organizationId" as OrganizationId,
      });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });
  });

  describe("given an individual cipher (without organization or collection)", () => {
    const cipher = createCipher({ organizationId: null, collectionIds: [] });

    it("should return false when filtering for unassigned collection", () => {
      const filterFunction = createFilterFunction({ collectionId: Unassigned });

      const result = filterFunction(cipher);

      expect(result).toBe(false);
    });

    it("should return true when filtering for my vault only", () => {
      const cipher = createCipher({ organizationId: null });
      const filterFunction = createFilterFunction({ organizationId: Unassigned });

      const result = filterFunction(cipher);

      expect(result).toBe(true);
    });
  });
});

// Keykeeper: an MSP's template copies show only in their collection.
describe("given a template copy an MSP keeps up to date", () => {
  const templates = "1bd2e94a-0d4a-4bd3-9d5c-5d5bb6d0b001" as CollectionId;
  const definition = (value: object) =>
    Object.assign(new FieldView(), {
      name: TEMPLATE_DEFINITION_FIELD_NAME,
      value: JSON.stringify({ id: "wifi-1", base: "note", v: 1, ...value }),
    });
  const copy = createCipher({
    type: CipherType.SecureNote,
    organizationId: "org" as OrganizationId,
    collectionIds: [templates],
  });
  copy.fields = [definition({ from: "Northwind IT" })];
  const ownTemplate = createCipher({ type: CipherType.SecureNote });
  ownTemplate.fields = [definition({})];

  it("leaves it out of the vault's lists", () => {
    for (const filter of [
      {},
      { type: "note" as const },
      { organizationId: "org" as OrganizationId },
    ]) {
      expect(createFilterFunction(filter)(copy)).toBe(false);
    }
  });

  it("shows it in its collection", () => {
    expect(createFilterFunction({ collectionId: templates })(copy)).toBe(true);
  });

  it("keeps someone's own templates in the lists, since they edit them there", () => {
    expect(createFilterFunction({})(ownTemplate)).toBe(true);
  });
});

function createCipher(options: Partial<CipherView> = {}) {
  const cipher = new CipherView();

  cipher.favorite = options.favorite ?? false;
  cipher.deletedDate = options.deletedDate;
  cipher.type = options.type ?? CipherType.Login;
  cipher.folderId = options.folderId;
  cipher.collectionIds = options.collectionIds;
  cipher.organizationId = options.organizationId;

  return cipher;
}
