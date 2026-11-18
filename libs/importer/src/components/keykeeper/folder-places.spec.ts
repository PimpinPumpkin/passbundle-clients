import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { OrganizationUserType } from "@bitwarden/common/admin-console/enums";
import { PermissionsApi } from "@bitwarden/common/admin-console/models/api/permissions.api";
import {
  CollectionTypes,
  CollectionView,
} from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CollectionId, OrganizationId } from "@bitwarden/common/types/guid";
import { DIALOG_DATA, DialogRef, DialogService, SelectComponent } from "@bitwarden/components";

import { FolderQuestion } from "../../services/keykeeper/folder-places";

import { folderPlacer, mayMakeFolders, placeableFolders, startingChoices } from "./folder-places";
import {
  FolderPlaceChoice,
  FolderPlacesDialogData,
  KeykeeperFolderPlacesDialogComponent,
  LEAVE_OUT,
  NEW_FOLDER,
} from "./folder-places-dialog.component";

const ORG = "11111111-1111-4111-8111-111111111111" as OrganizationId;
const OTHER_ORG = "22222222-2222-4222-8222-222222222222" as OrganizationId;
const ID = {
  clients: "aaaaaaaa-0000-4000-8000-000000000001",
  network: "aaaaaaaa-0000-4000-8000-000000000002",
  readOnly: "aaaaaaaa-0000-4000-8000-000000000003",
  dropBox: "aaaaaaaa-0000-4000-8000-000000000004",
  managed: "aaaaaaaa-0000-4000-8000-000000000005",
  myItems: "aaaaaaaa-0000-4000-8000-000000000006",
  elsewhere: "aaaaaaaa-0000-4000-8000-000000000007",
  notAssigned: "aaaaaaaa-0000-4000-8000-000000000008",
};

function organization(
  type: OrganizationUserType,
  more: Partial<Organization> = {},
  permissions: Partial<PermissionsApi> = {},
): Organization {
  return Object.assign(new Organization(), {
    id: ORG,
    name: "Test Dental",
    type,
    isProviderUser: false,
    limitCollectionCreation: true,
    allowAdminAccessToAllCollectionItems: true,
    permissions: Object.assign(new PermissionsApi(), permissions),
    ...more,
  });
}

/** A shared folder as the person holds it, with their grid there. */
function folder(
  name: string,
  id: string,
  grid: { create?: boolean; manage?: boolean; readOnly?: boolean } = {},
  more: Partial<CollectionView> = {},
): CollectionView {
  const c = new CollectionView({ id: id as CollectionId, organizationId: ORG, name });
  c.assigned = true;
  c.readOnly = grid.readOnly ?? false;
  c.manage = grid.manage ?? false;
  c.keykeeper = {
    seePasswords: true,
    create: grid.create ?? false,
    edit: !(grid.readOnly ?? false),
    delete: false,
    export: false,
    share: false,
    print: false,
    viewHistory: false,
    manage: grid.manage ?? false,
  };
  return Object.assign(c, more);
}

// Network has Firewall under it; Old is on its own; three items, one with no folder.
const question: FolderQuestion = {
  folders: [
    { index: 1, name: "Network", label: "Network", depth: 0, items: 1, subfolders: 1 },
    { index: 0, name: "Network/Firewall", label: "Firewall", depth: 1, items: 2, subfolders: 0 },
    { index: 2, name: "Old", label: "Old", depth: 0, items: 0, subfolders: 0, id: ID.clients },
  ],
  itemFolders: [[0], [0, 1], [1], []],
};

describe("placeableFolders", () => {
  const all = [
    folder("Network", ID.network, { create: true }),
    folder("Clients", ID.clients, { create: true }),
    // Can edit, but not add items: the grid's create is off.
    folder("Read only", ID.readOnly, { create: false }),
    // A drop folder: create without edit.
    folder("Drop box", ID.dropBox, { create: true, readOnly: true }),
    folder("Managed", ID.managed, { manage: true }),
    folder(
      "My Items",
      ID.myItems,
      { create: true },
      { type: CollectionTypes.DefaultUserCollection },
    ),
    folder("Elsewhere", ID.elsewhere, { create: true }, { organizationId: OTHER_ORG }),
    folder("Not mine", ID.notAssigned, { create: true }, { assigned: false }),
  ];

  it("offers the shared folders a member can add items to, by their grid, sorted by name", () => {
    const member = organization(OrganizationUserType.User);
    expect(placeableFolders(member, all).map((c) => c.name)).toEqual([
      "Clients",
      "Drop box",
      "Managed",
      "Network",
    ]);
  });

  it("offers an admin every shared folder here, but never someone's My Items", () => {
    const admin = organization(OrganizationUserType.Admin);
    expect(placeableFolders(admin, all).map((c) => c.name)).toEqual([
      "Clients",
      "Drop box",
      "Managed",
      "Network",
      "Not mine",
      "Read only",
    ]);
  });
});

describe("mayMakeFolders", () => {
  it("follows the web vault's New folder: owners and admins, or with the permission", () => {
    expect(mayMakeFolders(organization(OrganizationUserType.Owner))).toBe(true);
    expect(mayMakeFolders(organization(OrganizationUserType.Admin))).toBe(true);
    expect(mayMakeFolders(organization(OrganizationUserType.User))).toBe(false);
    expect(
      mayMakeFolders(organization(OrganizationUserType.Custom, {}, { createNewCollections: true })),
    ).toBe(true);
    expect(
      mayMakeFolders(organization(OrganizationUserType.User, { limitCollectionCreation: false })),
    ).toBe(true);
    expect(mayMakeFolders(organization(OrganizationUserType.Owner, { isProviderUser: true }))).toBe(
      false,
    );
  });
});

describe("startingChoices", () => {
  const existing = [
    folder("Clients", ID.clients, { create: true }),
    folder("Imports/Network", ID.network, { create: true }),
  ];

  it("starts each folder as a new shared folder, or the one here the file names by id", () => {
    expect(startingChoices(question, existing, true, null)).toEqual([
      NEW_FOLDER,
      NEW_FOLDER,
      ID.clients,
    ]);
  });

  it("without making folders, starts with the one here that has the new one's name, or nothing", () => {
    expect(startingChoices(question, existing, false, "Imports")).toEqual([
      null,
      ID.network,
      ID.clients,
    ]);
  });
});

describe("folderPlacer", () => {
  let dialogService: MockProxy<DialogService>;
  const answer = (choices: FolderPlaceChoice[] | undefined) =>
    dialogService.open.mockReturnValue({ closed: of(choices) } as unknown as DialogRef);
  const clients = folder("Clients", ID.clients, { create: true });
  const readOnly = folder("Read only", ID.readOnly, { create: false });

  beforeEach(() => {
    dialogService = mock<DialogService>();
  });

  it("isn't there for Personal or someone's My Items", () => {
    const myItems = folder(
      "My Items",
      ID.myItems,
      {},
      { type: CollectionTypes.DefaultUserCollection },
    );
    expect(folderPlacer(dialogService, undefined, null, of([]))).toBeUndefined();
    expect(
      folderPlacer(dialogService, organization(OrganizationUserType.Owner), myItems, of([])),
    ).toBeUndefined();
  });

  it("asks with the folders the person can add to, and gives back each folder's place", async () => {
    const placer = folderPlacer(
      dialogService,
      organization(OrganizationUserType.Owner),
      null,
      of([clients]),
    )!;
    answer([NEW_FOLDER, ID.clients, LEAVE_OUT]);

    const places = await placer(question);

    expect(dialogService.open).toHaveBeenCalledWith(KeykeeperFolderPlacesDialogComponent, {
      data: {
        organizationName: "Test Dental",
        target: null,
        mayMake: true,
        existing: [{ id: ID.clients, name: "Clients" }],
        question,
        start: [NEW_FOLDER, NEW_FOLDER, ID.clients],
      },
    });
    expect(places).toEqual([
      { kind: "new" },
      { kind: "existing", collection: clients },
      { kind: "leave" },
    ]);
  });

  it("never makes a folder for someone who can't, nor uses one they can't add to", async () => {
    const placer = folderPlacer(
      dialogService,
      organization(OrganizationUserType.User),
      clients,
      of([clients, readOnly]),
    )!;
    answer([NEW_FOLDER, ID.readOnly, ID.clients]);

    const places = await placer(question);

    const data = (dialogService.open.mock.calls[0][1] as { data: FolderPlacesDialogData }).data;
    expect(data.mayMake).toBe(false);
    expect(data.target).toBe("Clients");
    expect(data.existing).toEqual([{ id: ID.clients, name: "Clients" }]);
    expect(places).toEqual([
      { kind: "leave" },
      { kind: "leave" },
      { kind: "existing", collection: clients },
    ]);
  });

  it("gives back nothing when the question is closed", async () => {
    const placer = folderPlacer(
      dialogService,
      organization(OrganizationUserType.Owner),
      null,
      of([]),
    )!;
    answer(undefined);

    expect(await placer(question)).toBeNull();
  });
});

describe("KeykeeperFolderPlacesDialogComponent", () => {
  beforeAll(() => {
    // The dialog's scroll shadow watches its content; jsdom has no observer.
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });

  let fixture: ComponentFixture<KeykeeperFolderPlacesDialogComponent>;
  let dialogRef: MockProxy<DialogRef<FolderPlaceChoice[]>>;

  async function render(more: Partial<FolderPlacesDialogData> = {}) {
    const data: FolderPlacesDialogData = {
      organizationName: "Test Dental",
      target: null,
      mayMake: true,
      existing: [{ id: ID.clients, name: "Clients" }],
      question,
      start: [NEW_FOLDER, NEW_FOLDER, ID.clients],
      ...more,
    };
    dialogRef = mock<DialogRef<FolderPlaceChoice[]>>();
    const i18nService = mock<I18nService>();
    i18nService.t.mockImplementation((key) => key);
    await TestBed.configureTestingModule({
      imports: [KeykeeperFolderPlacesDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: dialogRef },
        { provide: I18nService, useValue: i18nService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperFolderPlacesDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, " ").trim();
  const rows = () => [...el().querySelectorAll('[data-testid="folder-place"]')];
  const selects = () =>
    fixture.debugElement
      .queryAll(By.directive(SelectComponent))
      .map((d) => d.componentInstance as SelectComponent<string>);
  const choose = (index: number, choice: FolderPlaceChoice) => {
    (fixture.componentInstance as unknown as { choices: { at(i: number): any } }).choices
      .at(index)
      .setValue(choice);
    fixture.detectChanges();
  };
  const importButton = () =>
    [...el().querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "Import",
    )!;

  it("lists each folder, subfolders under their parent, with its items and where it goes", async () => {
    await render();

    expect(text(el().querySelector("[bitDialogTitle]"))).toBe(
      "Where should each folder go in Test Dental?",
    );
    expect(text(el().querySelector('[data-testid="folder-places-intro"]'))).toBe(
      "This file has 4 items in 3 folders. Each becomes a new shared folder unless you choose " +
        "one that's already here, or leave it out. Subfolders have rows of their own. The 1 item " +
        "with no folder won't be in a shared folder.",
    );
    expect(rows().map((r) => text(r.querySelector(".tw-truncate")))).toEqual([
      "Network",
      "Firewall",
      "Old",
    ]);
    expect(rows().map((r) => text(r.querySelector("[bitTypography=helper]")))).toEqual([
      "1 item",
      "2 items",
      "No items",
    ]);
    expect(
      rows().map((r) => (r.firstElementChild as HTMLElement).style.paddingInlineStart),
    ).toEqual(["0rem", "1.25rem", "0rem"]);
    expect(rows().map((r) => text(r.querySelector("label")))).toEqual([
      "Where Network goes",
      "Where Network/Firewall goes",
      "Where Old goes",
    ]);
    expect(
      selects()[0]
        .items()
        ?.map((o) => [o.value, o.label]),
    ).toEqual([
      [NEW_FOLDER, "New shared folder"],
      [ID.clients, "Clients"],
      [LEAVE_OUT, "Leave out"],
    ]);
    expect(el().querySelector('[data-testid="folder-places-no-new"]')).toBeNull();
    expect(text(el().querySelector('[data-testid="folder-places-total"]'))).toBe(
      "Imports 4 items.",
    );
  });

  it("says where items with no folder and new shared folders go, with a shared folder chosen", async () => {
    await render({ target: "Imports" });

    expect(text(el().querySelector('[data-testid="folder-places-intro"]'))).toContain(
      "New shared folders go inside Imports. The 1 item with no folder goes into Imports.",
    );
  });

  it("gives back each folder's place, by its index", async () => {
    await render();
    choose(1, ID.clients);
    choose(0, LEAVE_OUT);

    importButton().click();

    expect(dialogRef.close).toHaveBeenCalledWith([LEAVE_OUT, ID.clients, ID.clients]);
  });

  it("says a parent's subfolders keep their own places when it goes somewhere else", async () => {
    await render();
    expect(rows()[0].querySelector("bit-hint")).toBeNull();

    choose(1, ID.clients);

    expect(text(rows()[0].querySelector("bit-hint"))).toBe(
      "Its subfolders go where their own rows say.",
    );
    expect(rows()[1].querySelector("bit-hint")).toBeNull();
  });

  it("counts what's left out, and imports nothing when every item would be", async () => {
    await render();
    choose(0, LEAVE_OUT);
    expect(text(el().querySelector('[data-testid="folder-places-total"]'))).toBe(
      "Imports 3 items and leaves out 1.",
    );

    choose(1, LEAVE_OUT);
    // The item with no folder still comes in.
    expect(text(el().querySelector('[data-testid="folder-places-total"]'))).toBe(
      "Imports 1 item and leaves out 3.",
    );
    expect(importButton().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("imports nothing when every item is left out", async () => {
    await render({ question: { ...question, itemFolders: [[0], [1]] } });
    choose(0, LEAVE_OUT);
    choose(1, LEAVE_OUT);

    expect(text(el().querySelector('[data-testid="folder-places-total"]'))).toBe(
      "Every item is left out, so there's nothing to import.",
    );
    expect(importButton().getAttribute("aria-disabled")).toBe("true");
    importButton().click();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("without making shared folders: no New, says why, and waits for every folder's place", async () => {
    await render({ mayMake: false, start: [null, null, ID.clients] });

    expect(text(el().querySelector('[data-testid="folder-places-no-new"]'))).toBe(
      "You can't make shared folders in Test Dental, so each folder goes into one that's " +
        "already here, or is left out. An owner or admin can make new ones.",
    );
    expect(
      selects()[0]
        .items()
        ?.map((o) => o.value),
    ).toEqual([ID.clients, LEAVE_OUT]);
    expect(text(el().querySelector('[data-testid="folder-places-total"]'))).toBe(
      "Choose where each folder goes.",
    );
    expect(importButton().getAttribute("aria-disabled")).toBe("true");

    choose(0, ID.clients);
    choose(1, LEAVE_OUT);
    expect(importButton().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("without making shared folders or any to add to: only Leave out", async () => {
    await render({ mayMake: false, existing: [], start: [null, null, null] });

    expect(text(el().querySelector('[data-testid="folder-places-no-new"]'))).toBe(
      "You can't make shared folders in Test Dental, and there are none here you can add " +
        "items to, so the file's folders can only be left out. An owner or admin can make new ones.",
    );
    expect(
      selects()[0]
        .items()
        ?.map((o) => o.value),
    ).toEqual([LEAVE_OUT]);
  });
});
