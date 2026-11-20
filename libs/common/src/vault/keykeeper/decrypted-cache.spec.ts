import { CipherData } from "../models/data/cipher.data";
import { CipherView } from "../models/view/cipher.view";

import { decryptedCacheIsCurrent } from "./decrypted-cache";

const saved = "2026-11-18T10:00:00.123456Z";
const savedAgain = "2026-11-18T10:00:01.654321Z";

const stored = (id: string, revisionDate = saved, more: Partial<CipherData> = {}) =>
  ({
    id,
    revisionDate,
    folderId: null,
    deletedDate: null,
    archivedDate: null,
    ...more,
  }) as CipherData;

/** An item as decrypted from what was stored, in the shape the shared copy keeps it (JSON and back). */
const decrypted = (data: CipherData) => {
  const view = new CipherView();
  view.id = data.id;
  view.revisionDate = new Date(data.revisionDate);
  view.folderId = data.folderId ?? undefined;
  view.deletedDate = data.deletedDate == null ? undefined : new Date(data.deletedDate);
  view.archivedDate = data.archivedDate == null ? undefined : new Date(data.archivedDate);
  return CipherView.fromJSON(JSON.parse(JSON.stringify(view)))!;
};

const record = (...items: CipherData[]) => Object.fromEntries(items.map((c) => [c.id, c]));

describe("decryptedCacheIsCurrent", () => {
  const a = stored("a");
  const b = stored("b");

  it("takes a copy of the stored items as they are", () => {
    expect(decryptedCacheIsCurrent([decrypted(a), decrypted(b)], [], record(a, b))).toBe(true);
  });

  it("refuses a copy from before an item was saved", () => {
    expect(decryptedCacheIsCurrent([decrypted(a)], [], record(a, b))).toBe(false);
  });

  it("refuses a copy from before an item was changed, as when a passkey is added to it", () => {
    const changed = stored("b", savedAgain);
    expect(decryptedCacheIsCurrent([decrypted(a), decrypted(b)], [], record(a, changed))).toBe(
      false,
    );
  });

  it("refuses a copy with an item that was deleted since", () => {
    expect(decryptedCacheIsCurrent([decrypted(a), decrypted(b)], [], record(a))).toBe(false);
  });

  it("refuses a copy from before an item went to the trash, which the device marks without a new revision", () => {
    const trashed = stored("b", saved, { deletedDate: savedAgain });
    expect(decryptedCacheIsCurrent([decrypted(a), decrypted(b)], [], record(a, trashed))).toBe(
      false,
    );
  });

  it("refuses a copy from before an item was archived or moved to a folder", () => {
    const archived = stored("b", saved, { archivedDate: savedAgain });
    const moved = stored("b", saved, { folderId: "folder-1" });
    expect(decryptedCacheIsCurrent([decrypted(a), decrypted(b)], [], record(a, archived))).toBe(
      false,
    );
    expect(decryptedCacheIsCurrent([decrypted(a), decrypted(b)], [], record(a, moved))).toBe(false);
  });

  it("takes a copy without an item that can't be decrypted, as long as it still can't", () => {
    const broken = stored("b");
    const failed = [decrypted(broken)];
    expect(decryptedCacheIsCurrent([decrypted(a)], failed, record(a, broken))).toBe(true);
    // The item was saved again since it failed, so it may decrypt now.
    expect(
      decryptedCacheIsCurrent([decrypted(a)], failed, record(a, stored("b", savedAgain))),
    ).toBe(false);
  });

  it("refuses a copy with an item whose revision isn't known", () => {
    const view = decrypted(a);
    view.revisionDate = undefined as unknown as Date;
    expect(decryptedCacheIsCurrent([view], [], record(a))).toBe(false);
  });

  it("takes an empty copy only when nothing is stored", () => {
    expect(decryptedCacheIsCurrent([], null, null)).toBe(true);
    expect(decryptedCacheIsCurrent([], null, record(a))).toBe(false);
  });
});
