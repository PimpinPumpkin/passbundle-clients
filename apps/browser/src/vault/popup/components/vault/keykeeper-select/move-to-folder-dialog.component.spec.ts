import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { DIALOG_DATA, DialogRef } from "@bitwarden/components";

import { KeykeeperMoveToFolderDialogComponent } from "./move-to-folder-dialog.component";

describe("KeykeeperMoveToFolderDialogComponent", () => {
  let fixture: ComponentFixture<KeykeeperMoveToFolderDialogComponent>;
  const close = jest.fn();

  const folder = (id: string | null, name: string) =>
    Object.assign(new FolderView(), { id, name }) as FolderView;

  beforeEach(async () => {
    close.mockClear();
    const folderService = mock<FolderService>();
    folderService.folderViews$.mockReturnValue(
      of([folder("f-home", "Home"), folder("f-work", "Work"), folder(null, "No folder")]),
    );

    await TestBed.configureTestingModule({
      imports: [KeykeeperMoveToFolderDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: DIALOG_DATA, useValue: { count: 3 } },
        { provide: DialogRef, useValue: { close } },
        { provide: FolderService, useValue: folderService },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "user-1" }) } },
        {
          provide: I18nService,
          useValue: { t: (key: string, ...p: unknown[]) => [key, ...p].join(" ") },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KeykeeperMoveToFolderDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const button = (label: string) =>
    Array.from(
      fixture.nativeElement.querySelectorAll("button") as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent!.trim() === label)!;

  it("says how many items it moves", () => {
    expect(fixture.nativeElement.textContent).toContain("keykeeperSelectMoveTitle 3");
  });

  it("closes with no choice on Cancel, so nothing moves", () => {
    button("cancel").click();

    expect(close).toHaveBeenCalledWith();
  });

  it("moves to the first folder unless another is picked", async () => {
    button("move").click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith({ folderId: "f-home" });
  });

  it("takes the items out of their folders with No folder", async () => {
    (fixture.componentInstance as any).form.controls.folderId.setValue(null);
    (fixture.componentInstance as any).form.controls.folderId.markAsDirty();
    button("move").click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith({ folderId: null });
  });
});
