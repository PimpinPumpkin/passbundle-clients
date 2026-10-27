// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// Keykeeper: see item-history.ts.
import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { ItemHistoryApiResponse, itemHistory } from "./item-history";

const editor = { id: "u1", name: "Ana", email: "ana@contoso.example" };

function current(viewPassword: boolean) {
  const item = new CipherView();
  item.id = "11111111-1111-1111-1111-111111111111";
  item.type = CipherType.Login;
  item.name = "Domain admin";
  item.viewPassword = viewPassword;
  return item;
}

function decrypted(password: string) {
  const view = new CipherView();
  view.id = "11111111-1111-1111-1111-111111111111";
  view.type = CipherType.Login;
  view.name = "Domain admin";
  view.login.password = password;
  return view;
}

function answer(hidePasswords: boolean, cipher: unknown = { id: "c" }): ItemHistoryApiResponse {
  return {
    cipherId: "11111111-1111-1111-1111-111111111111",
    revisionDate: "2026-10-20T10:00:00Z",
    savedBy: editor,
    hidePasswords,
    data: [
      {
        id: "v2",
        revisionDate: "2026-10-19T10:00:00Z",
        savedBy: editor,
        replacedDate: "2026-10-20T10:00:00Z",
        replacedBy: editor,
        cipher,
      },
    ],
  };
}

describe("itemHistory", () => {
  const apiService = mock<ApiService>();

  beforeEach(() => jest.resetAllMocks());

  it("asks the server for the item's history and decrypts each version", async () => {
    apiService.send.mockResolvedValue(answer(false));
    const decrypt = jest.fn(async (_: Cipher) => decrypted("old-password"));
    const versions = await itemHistory(apiService, current(true), decrypt);
    expect(apiService.send).toHaveBeenCalledWith(
      "GET",
      "/keykeeper/ciphers/11111111-1111-1111-1111-111111111111/history",
      null,
      true,
      true,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: "v2",
      revisionDate: "2026-10-19T10:00:00Z",
      savedBy: editor,
      replacedBy: editor,
    });
    expect(versions[0].item.login.password).toBe("old-password");
  });

  it("gives when and by whom only when the server hides the passwords", async () => {
    apiService.send.mockResolvedValue(answer(true, null));
    const decrypt = jest.fn();
    const versions = await itemHistory(apiService, current(true), decrypt);
    expect(versions[0].item).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("never decrypts a version for someone the item says can't see its passwords", async () => {
    apiService.send.mockResolvedValue(answer(false));
    const decrypt = jest.fn(async () => decrypted("old-password"));
    const versions = await itemHistory(apiService, current(false), decrypt);
    expect(versions[0].item).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
    expect(JSON.stringify(versions)).not.toContain("old-password");
  });

  it("says when a version couldn't be decrypted", async () => {
    apiService.send.mockResolvedValue(answer(false));
    const versions = await itemHistory(apiService, current(true), async () => {
      throw new Error("bad key");
    });
    expect(versions[0].item).toBeNull();
    expect(versions[0].unreadable).toBe(true);
  });
});
