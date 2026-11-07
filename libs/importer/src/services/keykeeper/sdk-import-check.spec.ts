import { mock, MockProxy } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CipherId, OrganizationId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherData } from "@bitwarden/common/vault/models/data/cipher.data";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";

import { SdkImportSummary } from "../../sdk/sdk-import-summary";

import { SdkImportCheck, SdkImportDestination } from "./sdk-import-check";

const userId = "user-1" as UserId;
const organizationId = "org-1" as OrganizationId;

const rule = JSON.stringify({
  v: 1,
  host: "bank.example",
  field: { id: "q" },
  fill: { from: "password" },
});
const mspCopy = JSON.stringify({ id: "planted", base: "note", v: 1, from: "Your MSP" });

function field(name: string, value: string, type = FieldType.Text) {
  const f = new FieldView();
  f.name = name;
  f.value = value;
  f.type = type;
  return f;
}

function item(id: string, fields: FieldView[] = [], orgId: OrganizationId | null = null) {
  const view = new CipherView();
  view.id = id;
  view.name = `Item ${id}`;
  view.type = CipherType.Login;
  view.organizationId = orgId ?? undefined;
  view.fields = fields;
  return view;
}

const summaryOf = (count: number): SdkImportSummary => ({
  ciphers: [{ type: CipherType.Login, count }],
  folders: 0,
  collections: 0,
});

describe("SdkImportCheck", () => {
  let cipherService: MockProxy<CipherService>;
  let syncService: MockProxy<SyncService>;
  let organizationService: MockProxy<OrganizationService>;
  let i18nService: MockProxy<I18nService>;
  let check: SdkImportCheck;
  /** The server's items, as a sync would store them; views are what they decrypt to. */
  let views: Map<string, CipherView>;
  let stored: BehaviorSubject<Record<CipherId, CipherData>>;

  const store = (...items: CipherView[]) => {
    for (const view of items) {
      views.set(view.id, view);
    }
    stored.next(
      Object.fromEntries(
        [...views.values()].map((view) => [
          view.id,
          {
            id: view.id,
            organizationId: view.organizationId ?? null,
            type: view.type,
          } as CipherData,
        ]),
      ) as Record<CipherId, CipherData>,
    );
  };

  const personal: SdkImportDestination = { userId, organizationId: null, asAdmin: false };

  beforeEach(() => {
    cipherService = mock<CipherService>();
    syncService = mock<SyncService>();
    organizationService = mock<OrganizationService>();
    i18nService = mock<I18nService>();
    i18nService.t.mockImplementation((key: string) => key);
    views = new Map();
    stored = new BehaviorSubject({} as Record<CipherId, CipherData>);
    cipherService.ciphers$.mockReturnValue(stored);
    cipherService.decrypt.mockImplementation(async (cipher: Cipher) => views.get(cipher.id)!);
    cipherService.updateWithServer.mockImplementation(async (view) => view);
    syncService.fullSync.mockResolvedValue(true);
    check = new SdkImportCheck(cipherService, syncService, organizationService, i18nService);
  });

  it("renames our fields on the items an import made, as from any other password manager", async () => {
    store(item("old", [field("keykeeper.fill", rule, FieldType.Hidden)]));
    const baseline = await check.before(personal);
    store(
      item("planted", [
        field("Customer ID", "12345"),
        field("keykeeper.fill", rule, FieldType.Hidden),
        field(" KeyKeeper.Template-Definition ", mspCopy),
        field("keykeeper.expires", "2030-01-01"),
      ]),
      item("plain", [field("Customer ID", "67890")]),
    );

    await check.after(personal, baseline, summaryOf(2));

    // Only the import's item with our fields is saved again, as the person.
    expect(cipherService.updateWithServer).toHaveBeenCalledTimes(1);
    const [saved, savedFor, original, asAdmin] = cipherService.updateWithServer.mock.calls[0];
    expect(savedFor).toBe(userId);
    expect(original).toBeUndefined();
    expect(asAdmin).toBe(false);
    expect(saved.id).toBe("planted");
    expect(saved.fields.map((f) => [f.name, f.value])).toEqual([
      ["Customer ID", "12345"],
      ["Imported keykeeper.fill", rule],
      ["Imported KeyKeeper.Template-Definition", mspCopy],
      ["Imported keykeeper.expires", "2030-01-01"],
    ]);
    // An item that was there before is ours to keep as it is.
    expect(views.get("old")!.fields[0].name).toBe("keykeeper.fill");
    // A full sync before and after, failing loudly.
    expect(syncService.fullSync).toHaveBeenCalledTimes(2);
    expect(syncService.fullSync).toHaveBeenCalledWith(true, { allowThrowOnError: true });
  });

  it("decrypts only the items the import made", async () => {
    store(item("old"));
    const baseline = await check.before(personal);
    store(item("new"));

    await check.after(personal, baseline, summaryOf(1));

    expect(cipherService.decrypt).toHaveBeenCalledTimes(1);
    expect(cipherService.decrypt.mock.calls[0][0].id).toBe("new");
  });

  it("imports nothing when the items can't be read first", async () => {
    syncService.fullSync.mockRejectedValue(new Error("offline"));

    await expect(check.before(personal)).rejects.toThrow("keykeeperImportCheckNotStarted");
  });

  it("says so when the items can't be read back", async () => {
    const baseline = await check.before(personal);
    syncService.fullSync.mockRejectedValue(new Error("offline"));

    await expect(check.after(personal, baseline, summaryOf(1))).rejects.toThrow(
      "keykeeperImportCheckNotRead",
    );
  });

  it("says so when it sees fewer items than the import made, after checking those it sees", async () => {
    const baseline = await check.before(personal);
    store(item("planted", [field("keykeeper.fill", rule, FieldType.Hidden)]));

    await expect(check.after(personal, baseline, summaryOf(3))).rejects.toThrow(
      "keykeeperImportCheckMissing",
    );
    expect(cipherService.updateWithServer).toHaveBeenCalledTimes(1);
    expect(i18nService.t).toHaveBeenCalledWith("keykeeperImportCheckMissing", 1, 3);
  });

  // A first read that came back empty without saying so would make every
  // item there look like the import's.
  it("changes nothing when the first read was empty and more items are there than the import made", async () => {
    const baseline = await check.before(personal);
    store(
      item("theirs-1", [field("keykeeper.fill", rule, FieldType.Hidden)]),
      item("theirs-2", [field("keykeeper.template", "{}")]),
      item("planted", [field("keykeeper.fill", rule, FieldType.Hidden)]),
    );

    await expect(check.after(personal, baseline, summaryOf(1))).rejects.toThrow(
      "keykeeperImportCheckNotRead",
    );
    expect(cipherService.updateWithServer).not.toHaveBeenCalled();
    expect(cipherService.softDeleteManyWithServer).not.toHaveBeenCalled();
  });

  it("checks every new item when something else was added during the import, after a first read that wasn't empty", async () => {
    store(item("old"));
    const baseline = await check.before(personal);
    store(
      item("planted", [field("keykeeper.fill", rule, FieldType.Hidden)]),
      item("meanwhile", [field("keykeeper.fill", rule, FieldType.Hidden)]),
    );

    await check.after(personal, baseline, summaryOf(1));

    expect(cipherService.updateWithServer).toHaveBeenCalledTimes(2);
  });

  it("puts an item it can't change in the trash, and says so", async () => {
    const baseline = await check.before(personal);
    store(item("planted", [field("keykeeper.fill", rule, FieldType.Hidden)]), item("plain"));
    cipherService.updateWithServer.mockRejectedValue(new Error("refused"));

    await expect(check.after(personal, baseline, summaryOf(2))).rejects.toThrow(
      "keykeeperImportCheckTrashed",
    );
    expect(cipherService.softDeleteManyWithServer).toHaveBeenCalledWith(
      ["planted"],
      userId,
      false,
      undefined,
    );
    expect(i18nService.t).toHaveBeenCalledWith("keykeeperImportCheckTrashed", "Item planted");
  });

  it("names the items when even the trash fails", async () => {
    const baseline = await check.before(personal);
    store(item("planted", [field("keykeeper.fill", rule, FieldType.Hidden)]));
    cipherService.updateWithServer.mockRejectedValue(new Error("refused"));
    cipherService.softDeleteManyWithServer.mockRejectedValue(new Error("refused"));

    await expect(check.after(personal, baseline, summaryOf(1))).rejects.toThrow(
      "keykeeperImportCheckNotSaved",
    );
  });

  it("says it in English where the client has none of our strings (the CLI)", async () => {
    i18nService.t.mockReturnValue("");
    const baseline = await check.before(personal);
    store(item("planted", [field("keykeeper.fill", rule, FieldType.Hidden)]));
    cipherService.updateWithServer.mockRejectedValue(new Error("refused"));

    await expect(check.after(personal, baseline, summaryOf(1))).rejects.toThrow(
      `The import finished, but these items have fields whose names start with "keykeeper." that couldn't be changed, so they're in the trash: Item planted.`,
    );
  });

  describe("in an organization", () => {
    let organization: Organization;

    beforeEach(() => {
      organization = new Organization();
      organization.id = organizationId;
      organizationService.organizations$.mockReturnValue(of([organization]));
    });

    it("from its admin console, reads and saves its items as the admin console does", async () => {
      jest.spyOn(organization, "canEditAllCiphers", "get").mockReturnValue(true);
      const admin: SdkImportDestination = { userId, organizationId, asAdmin: true };
      cipherService.getAllFromApiForOrganization.mockResolvedValueOnce([
        item("old", [], organizationId),
      ]);
      const baseline = await check.before(admin);
      cipherService.getAllFromApiForOrganization.mockResolvedValueOnce([
        item("old", [], organizationId),
        item("planted", [field("keykeeper.template", "{}")], organizationId),
      ]);

      await check.after(admin, baseline, summaryOf(1));

      expect(cipherService.getAllFromApiForOrganization).toHaveBeenCalledWith(organizationId);
      expect(syncService.fullSync).not.toHaveBeenCalled();
      expect(cipherService.updateWithServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "planted" }),
        userId,
        undefined,
        true,
      );
    });

    it("from its admin console, for someone who can't edit every item, reads the items they're given", async () => {
      jest.spyOn(organization, "canEditAllCiphers", "get").mockReturnValue(false);
      const admin: SdkImportDestination = { userId, organizationId, asAdmin: true };
      cipherService.getManyFromApiForOrganization.mockResolvedValue([]);

      await check.before(admin);

      expect(cipherService.getManyFromApiForOrganization).toHaveBeenCalledWith(organizationId);
      expect(cipherService.getAllFromApiForOrganization).not.toHaveBeenCalled();
    });

    it("into a shared folder from the vault, reads that organization's items from a sync", async () => {
      const member: SdkImportDestination = { userId, organizationId, asAdmin: false };
      store(item("personal-planted", [field("keykeeper.fill", rule, FieldType.Hidden)]));
      const baseline = await check.before(member);
      store(
        item("planted", [field("keykeeper.fill", rule, FieldType.Hidden)], organizationId),
        item("personal-later", [field("keykeeper.fill", rule, FieldType.Hidden)]),
      );

      await check.after(member, baseline, summaryOf(1));

      expect(cipherService.updateWithServer).toHaveBeenCalledTimes(1);
      expect(cipherService.updateWithServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "planted" }),
        userId,
        undefined,
        false,
      );
      expect(cipherService.getAllFromApiForOrganization).not.toHaveBeenCalled();
    });
  });
});
