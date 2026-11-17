import { TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherArchiveService } from "@bitwarden/common/vault/abstractions/cipher-archive.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherRepromptType } from "@bitwarden/common/vault/enums/cipher-reprompt-type";
import { CipherAuthorizationService } from "@bitwarden/common/vault/services/cipher-authorization.service";
import { DialogService, ToastService } from "@bitwarden/components";
import { BulkDeleteService, PasswordRepromptService } from "@bitwarden/vault";

import { PopupCipherViewLike } from "../../../views/popup-cipher.view";

import { KeykeeperMoveToFolderDialogComponent } from "./move-to-folder-dialog.component";
import { KeykeeperPopupSelectionService } from "./popup-selection.service";

const userId = "user-1" as UserId;

/** An item as the popup's list has it: an id (a UUID, as the server's are), a name, and what it allows. */
function item(n: number, more: Partial<PopupCipherViewLike> = {}): PopupCipherViewLike {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Item ${n}`,
    type: CipherType.Login,
    reprompt: CipherRepromptType.None,
    edit: true,
    viewPassword: true,
    collectionIds: [],
    ...more,
  } as unknown as PopupCipherViewLike;
}

const idOf = (row: PopupCipherViewLike) => row.id as string;

describe("KeykeeperPopupSelectionService", () => {
  let service: KeykeeperPopupSelectionService;
  let cipherService: MockProxy<CipherService>;
  let cipherArchiveService: MockProxy<CipherArchiveService>;
  let cipherAuthorizationService: MockProxy<CipherAuthorizationService>;
  let bulkDeleteService: MockProxy<BulkDeleteService>;
  let passwordRepromptService: MockProxy<PasswordRepromptService>;
  let dialogService: MockProxy<DialogService>;
  let toastService: MockProxy<ToastService>;
  let syncService: MockProxy<SyncService>;
  let canArchive$: BehaviorSubject<boolean>;
  /** Which items may be deleted, by id: the single item's own rule. */
  let deletable: Set<string>;

  const i18nT = jest.fn((key: string, ...placeholders: Array<string | number>) =>
    placeholders.length ? `${key}(${placeholders.join(",")})` : key,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    cipherService = mock<CipherService>();
    cipherArchiveService = mock<CipherArchiveService>();
    cipherAuthorizationService = mock<CipherAuthorizationService>();
    bulkDeleteService = mock<BulkDeleteService>();
    passwordRepromptService = mock<PasswordRepromptService>();
    dialogService = mock<DialogService>();
    toastService = mock<ToastService>();
    syncService = mock<SyncService>();
    canArchive$ = new BehaviorSubject(true);
    deletable = new Set();

    cipherArchiveService.userCanArchive$.mockReturnValue(canArchive$);
    cipherAuthorizationService.canDeleteCipher$.mockImplementation((c) =>
      of(deletable.has(c.id as string)),
    );
    dialogService.openSimpleDialog.mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        KeykeeperPopupSelectionService,
        { provide: AccountService, useValue: { activeAccount$: of({ id: userId }) } },
        { provide: CipherService, useValue: cipherService },
        { provide: CipherArchiveService, useValue: cipherArchiveService },
        { provide: CipherAuthorizationService, useValue: cipherAuthorizationService },
        { provide: BulkDeleteService, useValue: bulkDeleteService },
        { provide: PasswordRepromptService, useValue: passwordRepromptService },
        { provide: DialogService, useValue: dialogService },
        { provide: ToastService, useValue: toastService },
        { provide: I18nService, useValue: { t: i18nT } },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: SyncService, useValue: syncService },
      ],
    });
    service = TestBed.inject(KeykeeperPopupSelectionService);
  });

  /** Lets the signals that wait on observables (Move to trash's answer) catch up. */
  const settle = async () => {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const toasts = () => toastService.showToast.mock.calls.map(([t]) => `${t.variant}: ${t.message}`);

  describe("selecting", () => {
    const rows = [item(1), item(2), item(3), item(4)];

    beforeEach(() => {
      service.setListed(rows);
      service.start();
    });

    it("starts with nothing selected, and selects what is clicked", () => {
      expect(service.active()).toBe(true);
      expect(service.count()).toBe(0);

      service.click(rows[2], false);
      service.click(rows[0], false);

      expect(service.selected()).toEqual([rows[2], rows[0]]);
      expect(service.isSelected(rows[0])).toBe(true);
      expect(service.isSelected(rows[1])).toBe(false);
      expect(service.someSelected()).toBe(true);
    });

    it("selects a range with Shift", () => {
      service.click(rows[0], false);
      service.click(rows[2], true);

      expect(service.selected().map(idOf)).toEqual([rows[0], rows[2], rows[1]].map(idOf));
    });

    it("selects everything shown with Select all, and lets go of it with a second click", () => {
      service.clickAll();
      expect(service.count()).toBe(4);
      expect(service.allSelected()).toBe(true);

      service.clickAll();
      expect(service.count()).toBe(0);
    });

    it("never selects an item that couldn't be decrypted", () => {
      const broken = item(5, { decryptionFailure: true } as Partial<PopupCipherViewLike>);
      service.setListed([...rows, broken]);

      service.click(broken, false);
      service.clickAll();

      expect(service.isSelected(broken)).toBe(false);
      expect(service.count()).toBe(4);
      expect(service.allSelected()).toBe(true);
    });

    it("keeps the rows still listed when the list changes, and lets go of the rest", () => {
      service.click(rows[0], false);
      service.click(rows[3], false);

      // A search, another folder, or a sync: the list now has fresh copies of some rows.
      const fresh = item(1, { name: "Item 1, renamed" });
      service.setListed([fresh, rows[1]]);

      expect(service.selected()).toEqual([fresh]);
      // The one that left doesn't come back selected with the list.
      service.setListed(rows);
      expect(service.selected().map(idOf)).toEqual([idOf(rows[0])]);
    });

    it("lets go of everything when Select mode ends", () => {
      service.clickAll();
      service.stop();

      expect(service.active()).toBe(false);
      expect(service.count()).toBe(0);
    });
  });

  describe("what is offered", () => {
    const rows = [item(1), item(2)];

    beforeEach(() => {
      service.setListed(rows);
      service.start();
    });

    it("offers Move to trash when at least one selected item may be deleted", async () => {
      deletable.add(idOf(rows[1]));
      service.click(rows[0], false);
      await settle();
      expect(service.canTrash()).toBe(false);

      service.click(rows[1], false);
      await settle();
      expect(service.canTrash()).toBe(true);
    });

    it("offers Archive only to someone who can archive", async () => {
      service.click(rows[0], false);
      await settle();
      expect(service.canArchive()).toBe(true);

      canArchive$.next(false);
      await settle();
      expect(service.archiveOffered()).toBe(false);
      expect(service.canArchive()).toBe(false);
    });

    it("offers nothing with nothing selected", async () => {
      await settle();
      expect(service.canMove()).toBe(false);
      expect(service.canArchive()).toBe(false);
      expect(service.canTrash()).toBe(false);
    });
  });

  describe("Move to trash", () => {
    const rows = [item(1), item(2), item(3)];

    beforeEach(() => {
      service.setListed(rows);
      service.start();
      service.clickAll();
    });

    it("sends only the items that may be deleted, and says how many were skipped and why", async () => {
      deletable.add(idOf(rows[0]));
      deletable.add(idOf(rows[2]));

      await service.moveToTrash();

      const dialog = dialogService.openSimpleDialog.mock.calls[0][0];
      expect(dialog.title).toBe("keykeeperSelectTrashTitle(2)");
      expect(dialog.content).toBe("keykeeperBulkSkipDeleteOne(3) keykeeperSelectTrashBody");
      expect(bulkDeleteService.deleteCiphers).toHaveBeenCalledWith({
        cipherIds: [idOf(rows[0]), idOf(rows[2])],
        unassignedCiphers: [],
        permanent: false,
      });
      expect(toasts()).toEqual([
        "success: keykeeperSelectTrashed(2)",
        "info: keykeeperBulkSkippedOne",
      ]);
      expect(service.active()).toBe(false);
    });

    it("says nothing about skipping when every item may be deleted", async () => {
      rows.forEach((row) => deletable.add(idOf(row)));

      await service.moveToTrash();

      expect(dialogService.openSimpleDialog.mock.calls[0][0].content).toBe(
        "keykeeperSelectTrashBody",
      );
      expect(toasts()).toEqual(["success: keykeeperSelectTrashed(3)"]);
    });

    it("sends nothing when none may be deleted", async () => {
      await service.moveToTrash();

      expect(dialogService.openSimpleDialog).not.toHaveBeenCalled();
      expect(bulkDeleteService.deleteCiphers).not.toHaveBeenCalled();
      expect(toasts()).toEqual(["error: keykeeperBulkNothingAllowed"]);
      expect(service.active()).toBe(true);
    });

    it("sends nothing when the confirmation is cancelled", async () => {
      deletable.add(idOf(rows[0]));
      dialogService.openSimpleDialog.mockResolvedValue(false);

      await service.moveToTrash();

      expect(bulkDeleteService.deleteCiphers).not.toHaveBeenCalled();
      expect(service.count()).toBe(3);
    });

    it("asks for the master password once when an item it will touch asks for it", async () => {
      const guarded = item(9, { reprompt: CipherRepromptType.Password });
      service.setListed([...rows, guarded]);
      service.click(guarded, false);
      deletable.add(idOf(guarded));
      passwordRepromptService.showPasswordPrompt.mockResolvedValue(false);

      await service.moveToTrash();

      expect(passwordRepromptService.showPasswordPrompt).toHaveBeenCalledTimes(1);
      expect(bulkDeleteService.deleteCiphers).not.toHaveBeenCalled();
    });

    it("doesn't ask for the master password for an item it skips", async () => {
      const guarded = item(9, { reprompt: CipherRepromptType.Password });
      service.setListed([...rows, guarded]);
      service.click(guarded, false);
      deletable.add(idOf(rows[0]));

      await service.moveToTrash();

      expect(passwordRepromptService.showPasswordPrompt).not.toHaveBeenCalled();
      expect(bulkDeleteService.deleteCiphers).toHaveBeenCalled();
    });

    it("says some items may not have changed when the server refuses partway, and reads the vault again", async () => {
      rows.forEach((row) => deletable.add(idOf(row)));
      bulkDeleteService.deleteCiphers.mockRejectedValue(new Error("refused"));

      await service.moveToTrash();

      expect(toasts()).toEqual(["error: keykeeperBulkPartlyFailed"]);
      expect(syncService.fullSync).toHaveBeenCalledWith(true);
      expect(service.active()).toBe(false);
    });
  });

  describe("Move to folder", () => {
    const rows = [item(1), item(2)];

    beforeEach(() => {
      service.setListed(rows);
      service.start();
      service.clickAll();
    });

    afterEach(() => jest.restoreAllMocks());

    it("moves the selected items to the folder picked, in one request", async () => {
      const open = jest
        .spyOn(KeykeeperMoveToFolderDialogComponent, "open")
        .mockReturnValue({ closed: of({ folderId: "folder-1" }) } as any);

      await service.moveToFolder();

      expect(open).toHaveBeenCalledWith(dialogService, { count: 2 });
      expect(cipherService.moveManyWithServer).toHaveBeenCalledWith(
        rows.map(idOf),
        "folder-1",
        userId,
      );
      expect(toasts()).toEqual(["success: keykeeperSelectMoved(2)"]);
      expect(service.active()).toBe(false);
    });

    it("takes them out of their folders with No folder", async () => {
      jest
        .spyOn(KeykeeperMoveToFolderDialogComponent, "open")
        .mockReturnValue({ closed: of({ folderId: null }) } as any);

      await service.moveToFolder();

      expect(cipherService.moveManyWithServer).toHaveBeenCalledWith(rows.map(idOf), null, userId);
    });

    // An empty string is what a bare bitDialogClose closes with.
    it.each([undefined, "", {}])(
      "moves nothing when the dialog is closed without a choice (%p)",
      async (closedWith) => {
        jest
          .spyOn(KeykeeperMoveToFolderDialogComponent, "open")
          .mockReturnValue({ closed: of(closedWith) } as any);

        await service.moveToFolder();

        expect(cipherService.moveManyWithServer).not.toHaveBeenCalled();
        expect(service.count()).toBe(2);
        expect(service.active()).toBe(true);
      },
    );
  });

  describe("Archive", () => {
    const rows = [item(1), item(2)];

    beforeEach(() => {
      service.setListed(rows);
      service.start();
    });

    it("archives the selected items after the single item's own confirmation, worded for several", async () => {
      service.clickAll();

      await service.archive();

      const dialog = dialogService.openSimpleDialog.mock.calls[0][0];
      expect(dialog.title).toEqual({ key: "archiveItemsPlural", placeholders: [2] });
      expect(dialog.content).toEqual({ key: "archiveItemsPluralDescription" });
      expect(cipherArchiveService.archiveWithServer).toHaveBeenCalledWith(rows.map(idOf), userId);
      expect(toasts()).toEqual(["success: keykeeperSelectArchived(2)"]);
    });

    it("words it for one item when one is selected", async () => {
      service.click(rows[1], false);

      await service.archive();

      expect(dialogService.openSimpleDialog.mock.calls[0][0].title).toEqual({
        key: "archiveItemTitle",
      });
      expect(cipherArchiveService.archiveWithServer).toHaveBeenCalledWith([idOf(rows[1])], userId);
      expect(toasts()).toEqual(["success: itemArchiveToast"]);
    });

    it("archives nothing for someone who can't archive", async () => {
      canArchive$.next(false);
      service.clickAll();
      await settle();

      await service.archive();

      expect(cipherArchiveService.archiveWithServer).not.toHaveBeenCalled();
    });
  });
});
