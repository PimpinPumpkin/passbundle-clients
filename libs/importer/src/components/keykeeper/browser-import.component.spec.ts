import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { ValidationService } from "@bitwarden/common/platform/abstractions/validation.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";

import { ChromeCsvImporter } from "../../importers/chrome-csv-importer";
import { ImportServiceAbstraction } from "../../services";

import { KeykeeperBrowserImportComponent } from "./browser-import.component";

describe("KeykeeperBrowserImportComponent", () => {
  let fixture: ComponentFixture<KeykeeperBrowserImportComponent>;
  const importService = mock<ImportServiceAbstraction>();
  const cipherService = mock<CipherService>();
  let policyApplies: BehaviorSubject<boolean>;
  const policyService = {
    policyAppliesToUser$: jest.fn((_type: PolicyType, _userId: string) => policyApplies),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    policyApplies = new BehaviorSubject(false);
    importService.getImporter.mockReturnValue(new ChromeCsvImporter());
    cipherService.getAllDecrypted.mockResolvedValue([]);
    await TestBed.configureTestingModule({
      imports: [KeykeeperBrowserImportComponent],
      providers: [
        { provide: ImportServiceAbstraction, useValue: importService },
        { provide: CipherService, useValue: cipherService },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "ana" }) } },
        { provide: PolicyService, useValue: policyService },
        // For the component library's buttons.
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: ValidationService, useValue: mock<ValidationService>() },
      ],
    }).compileComponents();
  });

  async function render() {
    fixture = TestBed.createComponent(KeykeeperBrowserImportComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Picks a file and imports it, as the person would. */
  async function importText(el: HTMLElement, text: string) {
    const input = el.querySelector<HTMLInputElement>('[data-testid="browser-import-file"]')!;
    const file = { name: "Chrome Passwords.csv", text: async () => text } as unknown as File;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    fixture.detectChanges();
    await (
      fixture.componentInstance as unknown as { importFile: () => Promise<void> }
    ).importFile();
    fixture.detectChanges();
  }

  const error = (el: HTMLElement) =>
    el.querySelector('[data-testid="browser-import-error"]')?.textContent?.trim();

  it("says up front, and what to do, when an organization keeps items out of Personal", async () => {
    policyApplies.next(true);
    const el = await render();

    expect(policyService.policyAppliesToUser$).toHaveBeenCalledWith(
      PolicyType.OrganizationDataOwnership,
      "ana",
    );
    expect(el.querySelector('[data-testid="browser-import-blocked"]')?.textContent).toContain(
      "Ask an admin for a shared folder you can add to",
    );
    expect(el.querySelector('[data-testid="browser-import-file"]')).toBeNull();
  });

  it("says an export with no passwords has none, rather than that it isn't an export", async () => {
    const el = await render();

    await importText(el, "name,url,username,password,note\n");

    expect(error(el)).toContain("That export has no passwords in it.");
    expect(importService.importImportResult).not.toHaveBeenCalled();
  });

  it("still says a file that isn't an export isn't one", async () => {
    const el = await render();

    await importText(el, "just some notes");

    expect(error(el)).toContain("doesn't look like a");
  });

  it("says why when the server refuses the import, in plain words", async () => {
    const el = await render();
    const message =
      "Due to an Enterprise Policy, you are restricted from saving items to your personal vault.";
    importService.importImportResult.mockRejectedValue(
      new ErrorResponse({ message, validationErrors: { "": [message] } }, 400),
    );

    await importText(
      el,
      "name,url,username,password,note\nbank.example.com,https://bank.example.com/,ana,pw,\n",
    );

    expect(error(el)).toContain(
      "Your organization keeps everyone's items in its shared folders, so this can't go in Personal. Choose one of its shared folders instead.",
    );
    expect(el.querySelector('[data-testid="browser-import-summary"]')).toBeNull();
  });
});
