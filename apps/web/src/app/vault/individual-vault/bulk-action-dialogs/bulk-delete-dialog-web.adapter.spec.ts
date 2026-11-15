import { TestBed } from "@angular/core/testing";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CollectionId } from "@bitwarden/common/types/guid";
import { DialogService, ToastService } from "@bitwarden/components";
import {
  BulkDeleteDialogResult,
  BulkDeleteService,
  Vfo1TerminologyService,
} from "@bitwarden/vault";

import { BulkDeleteDialogWebAdapter } from "./bulk-delete-dialog-web.adapter";

// Keykeeper: what the confirmation says when the list left some of the
// selected items out, and what happens when the server refuses part of the way
// through (DESIGN.md, "Selecting several items").
describe("BulkDeleteDialogWebAdapter", () => {
  let adapter: BulkDeleteDialogWebAdapter;

  const openSimpleDialog = jest.fn();
  const showToast = jest.fn();
  const deleteCiphers = jest.fn();
  const deleteCollections = jest.fn();
  const t = jest.fn((key: string, ...placeholders: Array<string | number>) =>
    [key, ...placeholders.filter((p) => p != null)].join(" "),
  );

  const folder = (id: string) => ({ id: id as CollectionId, name: id }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    openSimpleDialog.mockResolvedValue(true);
    deleteCiphers.mockResolvedValue(undefined);
    deleteCollections.mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        BulkDeleteDialogWebAdapter,
        { provide: DialogService, useValue: { openSimpleDialog } },
        { provide: ToastService, useValue: { showToast } },
        { provide: I18nService, useValue: { t } },
        { provide: BulkDeleteService, useValue: { deleteCiphers, deleteCollections } },
        { provide: Vfo1TerminologyService, useValue: { enabled: () => false } },
      ],
    });
    adapter = TestBed.inject(BulkDeleteDialogWebAdapter);
  });

  it("asks once and says how many items will be deleted", async () => {
    const result = await adapter.open({ cipherIds: ["a", "b", "c"] });

    expect(openSimpleDialog).toHaveBeenCalledTimes(1);
    expect(openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "danger",
        title: { key: "deleteItemsCount", placeholders: [3] },
        content: { key: "deleteItemsDesc" },
      }),
    );
    expect(deleteCiphers).toHaveBeenCalledWith(
      expect.objectContaining({ cipherIds: ["a", "b", "c"], permanent: false }),
    );
    expect(result).toBe(BulkDeleteDialogResult.Deleted);
  });

  it("says how many are skipped, and why, above its own sentence", async () => {
    await adapter.open({
      cipherIds: ["a", "b"],
      notice: "1 of the 3 items you selected will be skipped.",
    });

    expect(openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: { key: "deleteItemsCount", placeholders: [2] },
        content: "1 of the 3 items you selected will be skipped. deleteItemsDesc",
      }),
    );
  });

  it("puts the notice in the trash's confirmation as well", async () => {
    await adapter.open({ cipherIds: ["a", "b"], permanent: true, notice: "Some are skipped." });

    expect(openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: { key: "deleteItemsPermanentlyCount", placeholders: [2] },
        content: "Some are skipped. deleteItemsPermanentlyDesc",
      }),
    );
    expect(deleteCiphers).toHaveBeenCalledWith(expect.objectContaining({ permanent: true }));
  });

  it("puts the notice in the confirmation for shared folders", async () => {
    await adapter.open({ collections: [folder("one"), folder("two")], notice: "One is skipped." });

    expect(openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({ content: "One is skipped. deleteCollectionsDesc" }),
    );
  });

  it("puts the notice in the confirmation for items and shared folders together", async () => {
    await adapter.open({
      cipherIds: ["a"],
      collections: [folder("one")],
      notice: "One is skipped.",
    });

    expect(openSimpleDialog).toHaveBeenCalledWith(
      expect.objectContaining({ content: "One is skipped. deleteItemsAndCollectionsDesc" }),
    );
  });

  it("deletes nothing when the person cancels", async () => {
    openSimpleDialog.mockResolvedValue(false);

    const result = await adapter.open({ cipherIds: ["a", "b"] });

    expect(deleteCiphers).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(result).toBe(BulkDeleteDialogResult.Canceled);
  });

  it("has nothing to do for an empty selection", async () => {
    const result = await adapter.open({});

    expect(openSimpleDialog).not.toHaveBeenCalled();
    expect(result).toBe(BulkDeleteDialogResult.Canceled);
  });

  it("says some may not have changed when the server refuses, and doesn't claim success", async () => {
    deleteCiphers.mockRejectedValue(new Error("refused"));

    const result = await adapter.open({ cipherIds: ["a", "b"] });

    expect(result).toBe(BulkDeleteDialogResult.Failed);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({
      variant: "error",
      message: "keykeeperBulkPartlyFailed",
    });
  });

  it("says the same when deleting shared folders is refused", async () => {
    deleteCollections.mockRejectedValue(new Error("refused"));

    const result = await adapter.open({ collections: [folder("one"), folder("two")] });

    expect(result).toBe(BulkDeleteDialogResult.Failed);
    expect(showToast).toHaveBeenCalledWith({
      variant: "error",
      message: "keykeeperBulkPartlyFailed",
    });
  });

  it("says the same when part of a mixed selection is refused", async () => {
    deleteCollections.mockRejectedValue(new Error("refused"));

    const result = await adapter.open({ cipherIds: ["a"], collections: [folder("one")] });

    expect(result).toBe(BulkDeleteDialogResult.Failed);
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
