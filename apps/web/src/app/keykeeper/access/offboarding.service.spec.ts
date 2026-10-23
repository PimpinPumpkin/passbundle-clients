import { mock, MockProxy } from "jest-mock-extended";

import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogService } from "@bitwarden/components";

import { AccessItemInput, AccessMemberInput, reviewAccess } from "./access-review";
import { KeykeeperAccessReviewService, LoadedAccess } from "./access-review.service";
import { KeykeeperOffboardingService } from "./offboarding.service";
import { KeykeeperSeenPasswordsDialogComponent } from "./seen-passwords-dialog.component";

const folders = [
  { id: "front", name: "Front desk" },
  { id: "payroll", name: "Payroll" },
];

const items: AccessItemInput[] = [
  { id: "wifi", name: "Wi-Fi", type: CipherType.Login, collectionIds: ["front"], deleted: false },
  { id: "bank", name: "Bank", type: CipherType.Login, collectionIds: ["payroll"], deleted: false },
];

function member(extra: Partial<AccessMemberInput>): AccessMemberInput {
  return {
    id: "alex",
    name: "Alex",
    email: "alex@example.test",
    role: "user",
    status: "confirmed",
    allItems: false,
    mspStaff: false,
    collections: [{ id: "front", readOnly: true, hidePasswords: false, manage: false }],
    groups: [],
    ...extra,
  };
}

function loaded(m: AccessMemberInput): LoadedAccess {
  return {
    review: reviewAccess({
      members: [m],
      groups: [],
      folders,
      items,
      adminsSeeEverything: true,
    }),
    items: new Map(items.map((i) => [i.id, { id: i.id } as CipherView])),
    itemInputs: items,
    hiddenFolders: 0,
  };
}

describe("KeykeeperOffboardingService", () => {
  let accessReview: MockProxy<KeykeeperAccessReviewService>;
  let dialogService: MockProxy<DialogService>;
  let logService: MockProxy<LogService>;
  let service: KeykeeperOffboardingService;
  const org = { id: "org", canManageUsers: true, canViewAllCollections: true } as Organization;

  beforeEach(() => {
    accessReview = mock<KeykeeperAccessReviewService>();
    dialogService = mock<DialogService>();
    logService = mock<LogService>();
    const i18n = mock<I18nService>();
    i18n.t.mockImplementation((key: string, ...args: any[]) =>
      args.length ? `${key}(${args.join("|")})` : key,
    );
    service = new KeykeeperOffboardingService(accessReview, dialogService, i18n, logService);
  });

  it("says what someone can open, and keeps the logins whose passwords they could see", async () => {
    accessReview.load.mockResolvedValue(loaded(member({})));

    const offboarding = await service.prepare(org, "alex", "Alex");

    expect(offboarding!.summary).toBe(
      "keykeeperReachFolders(Alex|keykeeperOneSharedFolder|keykeeperOneItem)",
    );
    expect(offboarding!.dialog.passwords.map((p) => p.item.name)).toEqual(["Wi-Fi"]);
    expect(offboarding!.dialog.everyItem).toBe(false);
    expect(offboarding!.dialog.openInAdminConsole).toBe(true);
  });

  it("offers every login for someone who saw every item", async () => {
    accessReview.load.mockResolvedValue(loaded(member({ role: "admin" })));

    const offboarding = await service.prepare(org, "alex", "Alex");

    expect(offboarding!.dialog.everyItem).toBe(true);
    expect(offboarding!.dialog.passwords.map((p) => p.item.name)).toEqual(["Bank", "Wi-Fi"]);
  });

  it("lists nothing for someone never confirmed, who never had the key", async () => {
    accessReview.load.mockResolvedValue(loaded(member({ status: "pending" })));

    const offboarding = await service.prepare(org, "alex", "Alex");

    expect(offboarding!.summary).toBe("keykeeperReachNeverConfirmed(Alex)");
    expect(offboarding!.dialog.passwords).toEqual([]);
  });

  it("asks nothing of the server for someone who can't manage members", async () => {
    const offboarding = await service.prepare(
      { ...org, canManageUsers: false } as Organization,
      "alex",
      "Alex",
    );

    expect(offboarding).toBeNull();
    expect(accessReview.load).not.toHaveBeenCalled();
  });

  it("never stands in the way of removing someone when it can't load", async () => {
    accessReview.load.mockRejectedValue(new Error("offline"));

    expect(await service.prepare(org, "alex", "Alex")).toBeNull();
    expect(logService.error).toHaveBeenCalled();
  });

  it("shows the list once there's something to change, and only then", async () => {
    const openSpy = jest
      .spyOn(KeykeeperSeenPasswordsDialogComponent, "open")
      .mockReturnValue(null!);
    accessReview.load.mockResolvedValue(loaded(member({})));
    const offboarding = await service.prepare(org, "alex", "Alex");

    service.showPasswords(null);
    service.showPasswords({ ...offboarding!, dialog: { ...offboarding!.dialog, passwords: [] } });
    expect(openSpy).not.toHaveBeenCalled();

    service.showPasswords(offboarding);
    expect(openSpy).toHaveBeenCalledWith(dialogService, offboarding!.dialog);
    openSpy.mockRestore();
  });
});
