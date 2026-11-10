import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherData } from "@bitwarden/common/vault/models/data/cipher.data";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { saveFavorite } from "./favorite";

describe("saveFavorite", () => {
  const userId = "user-1" as UserId;
  const putPartialCipher = jest.fn();
  const upsert = jest.fn();
  const apiService = { putPartialCipher } as unknown as ApiService;
  const cipherService = { upsert } as unknown as CipherService;

  const item = (overrides: Partial<CipherView> = {}) =>
    Object.assign(new CipherView(), {
      id: "item-1",
      folderId: "folder-1",
      favorite: false,
      collectionIds: ["shared-1"],
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    putPartialCipher.mockImplementation(async (id: string) => ({ id }));
    upsert.mockResolvedValue(undefined);
  });

  it("saves only the star, and leaves the item in the folder it is in", async () => {
    await saveFavorite(apiService, cipherService, item(), true, userId);

    expect(putPartialCipher).toHaveBeenCalledTimes(1);
    expect(putPartialCipher).toHaveBeenCalledWith("item-1", {
      folderId: "folder-1",
      favorite: true,
    });
  });

  it("keeps what the server sent back, with the item's shared folders", async () => {
    await saveFavorite(apiService, cipherService, item(), true, userId);

    expect(upsert).toHaveBeenCalledTimes(1);
    const [saved, forUser] = upsert.mock.calls[0];
    expect(saved).toBeInstanceOf(CipherData);
    expect(saved.collectionIds).toEqual(["shared-1"]);
    expect(forUser).toBe(userId);
  });

  it("shows the star on the item once it is saved", async () => {
    const cipher = item();

    await saveFavorite(apiService, cipherService, cipher, true, userId);

    expect(cipher.favorite).toBe(true);
  });

  it("takes the star away the same way", async () => {
    const cipher = item({ favorite: true });

    await saveFavorite(apiService, cipherService, cipher, false, userId);

    expect(putPartialCipher).toHaveBeenCalledWith("item-1", {
      folderId: "folder-1",
      favorite: false,
    });
    expect(cipher.favorite).toBe(false);
  });

  it("leaves the item as it was when the server refuses", async () => {
    putPartialCipher.mockRejectedValue(new Error("refused"));
    const cipher = item();

    await expect(saveFavorite(apiService, cipherService, cipher, true, userId)).rejects.toThrow(
      "refused",
    );

    expect(upsert).not.toHaveBeenCalled();
    expect(cipher.favorite).toBe(false);
  });
});
