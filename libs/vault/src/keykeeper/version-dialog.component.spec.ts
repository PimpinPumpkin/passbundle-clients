import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";

import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { DIALOG_DATA, DialogRef, DialogService, ToastService } from "@bitwarden/components";

import { KeykeeperVersionDialogComponent, VersionDialogData } from "./version-dialog.component";

function login(password: string) {
  const item = new CipherView();
  item.id = "item-1";
  item.type = CipherType.Login;
  item.name = "Mail";
  item.login = new LoginView();
  item.login.password = password;
  item.revisionDate = new Date("2026-10-23T10:00:00Z");
  item.viewPassword = true;
  return item;
}

/** A refusal as the server sends it, as upstream's ApiService throws it. */
const refusal = (message: string) =>
  new ErrorResponse({ message, validationErrors: { "": [message] }, object: "error" }, 400);

describe("KeykeeperVersionDialogComponent", () => {
  const toastService = mock<ToastService>();
  const dialogRef = mock<DialogRef>();
  const dialogService = mock<DialogService>();

  function open(data: Partial<VersionDialogData>) {
    TestBed.configureTestingModule({
      imports: [KeykeeperVersionDialogComponent],
      providers: [
        {
          provide: DIALOG_DATA,
          useValue: {
            version: login("one"),
            current: login("two"),
            revisionDate: new Date("2026-10-22T10:00:00Z"),
            savedBy: null,
            ...data,
          },
        },
        { provide: DialogRef, useValue: dialogRef },
        { provide: DialogService, useValue: dialogService },
        { provide: ToastService, useValue: toastService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    });
    // The dialog's own module provides the dialog service; the confirmations are the test's.
    TestBed.overrideProvider(DialogService, { useValue: dialogService });
    return TestBed.createComponent(KeykeeperVersionDialogComponent)
      .componentInstance as unknown as {
      restore: () => Promise<void>;
      deleteVersion: () => Promise<void>;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    dialogService.openSimpleDialog.mockResolvedValue(true);
  });

  it("says why when the server refuses the restore, in plain words, and stays open", async () => {
    const dialog = open({
      restore: () =>
        Promise.reject(
          refusal(
            "The client copy of this cipher is out of date. Resync the client and try again.",
          ),
        ),
    });

    await dialog.restore();

    expect(toastService.showToast).toHaveBeenCalledWith({
      variant: "error",
      message: "This item changed since you opened it. Close it, open it again, and try once more.",
    });
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("says why when the server refuses to delete the version, and stays open", async () => {
    const reason = "You don't have permission to delete this item's versions";
    const dialog = open({ delete: () => Promise.reject(refusal(reason)) });

    await dialog.deleteVersion();

    expect(toastService.showToast).toHaveBeenCalledWith({ variant: "error", message: reason });
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("closes with the deleted version once the server deletes it", async () => {
    const dialog = open({ delete: () => Promise.resolve() });

    await dialog.deleteVersion();

    expect(toastService.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "keykeeperVersionDeleted" }),
    );
    expect(dialogRef.close).toHaveBeenCalledWith("deleted");
  });
});
