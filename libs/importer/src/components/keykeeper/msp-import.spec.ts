import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DIALOG_DATA, DialogRef, DialogService } from "@bitwarden/components";

import { ChromeCsvImporter } from "../../importers/chrome-csv-importer";
import { ITGlueCsvImporter, PassportalCsvImporter } from "../../importers/msp";

import {
  KeykeeperMspCustomerDialogComponent,
  MspCustomerChoice,
  MspCustomerDialogData,
} from "./msp-customer-dialog.component";
import { chooseMspCustomer, mspImportSteps } from "./msp-import";

// Made up by hand: two Passportal clients, and a row that names none.
const TWO_CLIENTS = [
  "Client Name,Credential Type,Username,Password,Description,URL,Folder",
  "Test Dental Group,Router,admin,Fake-Pass-1,Router,,Network",
  "Example Plumbing Co,Website,owner,Fake-Pass-2,Bank,,",
  "Test Dental Group,Website,office,Fake-Pass-3,Supplier,,",
  ",Website,someone,Fake-Pass-4,Nobody's,,",
].join("\n");

describe("chooseMspCustomer", () => {
  let dialogService: MockProxy<DialogService>;

  const answer = (choice: MspCustomerChoice | undefined) =>
    dialogService.open.mockReturnValue({ closed: of(choice) } as unknown as DialogRef);

  beforeEach(() => {
    dialogService = mock<DialogService>();
  });

  it("asks whose rows go in, with each client's count, and imports only those", async () => {
    const importer = new PassportalCsvImporter();
    answer({ customer: "Test Dental Group" });

    expect(await chooseMspCustomer(dialogService, importer, TWO_CLIENTS, "Test Dental")).toBe(true);

    expect(dialogService.open).toHaveBeenCalledWith(KeykeeperMspCustomerDialogComponent, {
      data: {
        organizationName: "Test Dental",
        customerWord: { one: "client", many: "clients" },
        customers: [
          { name: "Example Plumbing Co", rows: 1 },
          { name: "Test Dental Group", rows: 2 },
          { name: "", rows: 1 },
        ],
      },
    });
    expect(importer.onlyCustomer).toBe("Test Dental Group");
    const result = await importer.parse(TWO_CLIENTS);
    expect(result.ciphers.map((c) => c.name)).toEqual(["Router", "Supplier"]);
  });

  it("imports every client, each its own folder, for All of them", async () => {
    const importer = new PassportalCsvImporter();
    importer.onlyCustomer = "Example Plumbing Co";
    answer({ all: true });

    expect(await chooseMspCustomer(dialogService, importer, TWO_CLIENTS, "Test Dental")).toBe(true);

    expect(importer.onlyCustomer).toBeNull();
  });

  it("imports nothing when the question is closed without a choice", async () => {
    const importer = new PassportalCsvImporter();
    answer(undefined);

    expect(await chooseMspCustomer(dialogService, importer, TWO_CLIENTS, "Test Dental")).toBe(
      false,
    );
  });

  it("doesn't ask about a file with one customer", async () => {
    const oneOrganization =
      "organization,name,username,password\nSample Law LLP,Wi-Fi,,Fake-1\nSample Law LLP,Fax,a,Fake-2";

    expect(
      await chooseMspCustomer(
        dialogService,
        new ITGlueCsvImporter(),
        oneOrganization,
        "Sample Law",
      ),
    ).toBe(true);
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it("doesn't ask about another format, or a file that isn't the format's", async () => {
    expect(
      await chooseMspCustomer(dialogService, new ChromeCsvImporter(), TWO_CLIENTS, "Test Dental"),
    ).toBe(true);
    expect(
      await chooseMspCustomer(dialogService, new ITGlueCsvImporter(), TWO_CLIENTS, "Test Dental"),
    ).toBe(true);
    expect(dialogService.open).not.toHaveBeenCalled();
  });
});

describe("mspImportSteps", () => {
  it("has each vendor's export steps, and nothing for other formats", () => {
    expect(mspImportSteps("passportalcsv")).toContain("check Include headers");
    expect(mspImportSteps("itgluecsv")).toContain("choose its passwords.csv here");
    expect(mspImportSteps("chromecsv")).toBeNull();
    expect(mspImportSteps(null)).toBeNull();
  });
});

describe("KeykeeperMspCustomerDialogComponent", () => {
  let fixture: ComponentFixture<KeykeeperMspCustomerDialogComponent>;
  let dialogRef: MockProxy<DialogRef<MspCustomerChoice>>;

  const data: MspCustomerDialogData = {
    organizationName: "Test Dental",
    customerWord: { one: "client", many: "clients" },
    customers: [
      { name: "Example Plumbing Co", rows: 1 },
      { name: "Test Dental Group", rows: 2 },
      { name: "", rows: 1 },
    ],
  };

  beforeEach(async () => {
    dialogRef = mock<DialogRef<MspCustomerChoice>>();
    const i18nService = mock<I18nService>();
    i18nService.t.mockImplementation((key) => key);
    await TestBed.configureTestingModule({
      imports: [KeykeeperMspCustomerDialogComponent],
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: dialogRef },
        { provide: I18nService, useValue: i18nService },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperMspCustomerDialogComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const radios = () => [...el().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const labels = () =>
    [...el().querySelectorAll("bit-radio-button")].map((r) =>
      r.querySelector("bit-label")?.textContent?.replace(/\s+/g, " ").trim(),
    );
  const importButton = () =>
    [...el().querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "Import",
    )!;

  it("lists each client with how many passwords it has, then all of them", () => {
    expect(el().textContent).toContain("Which client goes into Test Dental?");
    expect(el().textContent).toContain("This export has passwords for 2 clients.");
    expect(labels()).toEqual([
      "Example Plumbing Co, 1 password",
      "Test Dental Group, 2 passwords",
      "No client, 1 password",
      "All of them, 4 passwords",
    ]);
    expect(el().textContent).toContain("Each client gets its own shared folder in Test Dental.");
  });

  it("imports nothing until one is chosen", () => {
    // The component library's buttons say they're off with aria-disabled.
    expect(importButton().getAttribute("aria-disabled")).toBe("true");
    importButton().click();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("gives back the client chosen", () => {
    radios()[1].click();
    fixture.detectChanges();
    expect(importButton().getAttribute("aria-disabled")).not.toBe("true");
    importButton().click();
    expect(dialogRef.close).toHaveBeenCalledWith({ customer: "Test Dental Group" });
  });

  it("gives back the rows with no client, and all of them", () => {
    radios()[2].click();
    fixture.detectChanges();
    importButton().click();
    expect(dialogRef.close).toHaveBeenLastCalledWith({ customer: "" });

    radios()[3].click();
    fixture.detectChanges();
    importButton().click();
    expect(dialogRef.close).toHaveBeenLastCalledWith({ all: true });
  });
});
