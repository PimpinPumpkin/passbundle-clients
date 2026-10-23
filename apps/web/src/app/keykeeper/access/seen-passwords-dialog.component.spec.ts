import { Router } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { DialogRef, DialogService, ToastService } from "@bitwarden/components";

import {
  KeykeeperSeenPasswordsDialogComponent,
  SeenPasswordsDialogData,
} from "./seen-passwords-dialog.component";

const login = (id: string, name: string) => ({
  id,
  name,
  type: CipherType.Login,
  collectionIds: ["front"],
  deleted: false,
});

function data(extra: Partial<SeenPasswordsDialogData> = {}): SeenPasswordsDialogData {
  return {
    name: "Alex",
    organizationId: "org",
    openInAdminConsole: true,
    everyItem: false,
    passwords: [
      { item: login("wifi", "Wi-Fi"), folders: [{ id: "front", name: "Front desk" }] },
      { item: login("bank", "Bank"), folders: [] },
    ],
    items: new Map(),
    ...extra,
  };
}

describe("KeykeeperSeenPasswordsDialogComponent", () => {
  let dialogRef: MockProxy<DialogRef>;
  let router: MockProxy<Router>;
  let platformUtils: MockProxy<PlatformUtilsService>;
  let toast: MockProxy<ToastService>;

  function create(d: SeenPasswordsDialogData) {
    const i18n = mock<I18nService>();
    i18n.t.mockImplementation((key: string) => key);
    return new KeykeeperSeenPasswordsDialogComponent(
      d,
      dialogRef,
      router,
      i18n,
      platformUtils,
      toast,
    );
  }

  beforeEach(() => {
    dialogRef = mock<DialogRef>();
    router = mock<Router>();
    platformUtils = mock<PlatformUtilsService>();
    toast = mock<ToastService>();
  });

  it("copies names and shared folders, and says so", () => {
    const component = create(data());

    component["copy"]();

    expect(platformUtils.copyToClipboard).toHaveBeenCalledWith(
      "name\tkeykeeperSeenPasswordsFolders\nWi-Fi\tFront desk\nBank\tkeykeeperSeenPasswordsNoFolder\n",
    );
    expect(toast.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "keykeeperSeenPasswordsCopied" }),
    );
  });

  it("opens an item in the admin console's vault, or in the person's own vault", async () => {
    await create(data())["open"](data().passwords[0]);
    expect(router.navigate).toHaveBeenCalledWith(["/organizations", "org", "vault"], {
      queryParams: { itemId: "wifi", action: "view" },
    });

    await create(data({ openInAdminConsole: false }))["open"](data().passwords[1]);
    expect(router.navigate).toHaveBeenLastCalledWith(["/vault"], {
      queryParams: { itemId: "bank", action: "view" },
    });
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("shows the list at once, or after a click for someone who saw every item", () => {
    expect(create(data())["showing"]()).toBe(true);
    expect(create(data({ everyItem: true }))["showing"]()).toBe(false);
  });

  it("closes only with Done or by going to the Access page", async () => {
    await create(data())["done"]();
    expect(dialogRef.close).toHaveBeenCalledTimes(1);

    await create(data())["openAccessPage"]();
    expect(dialogRef.close).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledWith(["/organizations", "org", "access"]);
  });

  it("can't be closed by accident", () => {
    const dialogService = mock<DialogService>();

    KeykeeperSeenPasswordsDialogComponent.open(dialogService, data());

    expect(dialogService.open).toHaveBeenCalledWith(
      KeykeeperSeenPasswordsDialogComponent,
      expect.objectContaining({ disableClose: true, closeOnNavigation: false }),
    );
  });
});
