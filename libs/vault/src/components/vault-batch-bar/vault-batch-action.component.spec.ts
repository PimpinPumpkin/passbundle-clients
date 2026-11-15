import { PortalModule } from "@angular/cdk/portal";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LayoutFooterService } from "@bitwarden/components";

import { VaultBatchBarService } from "../../services/vault-batch-bar.service";
import { Vfo1TerminologyService } from "../../services/vfo1-terminology.service";

import { VaultBatchActionComponent } from "./vault-batch-action.component";

@Component({
  selector: "test-footer-outlet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PortalModule],
  template: `<ng-template [cdkPortalOutlet]="footerPortal()"></ng-template>`,
})
class FooterOutletComponent {
  protected readonly footerPortal = inject(LayoutFooterService).portal;
}

// JSDOM does not implement ResizeObserver — stub so BulkActionsBarComponent can construct.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

describe("VaultBatchActionComponent", () => {
  let component: VaultBatchActionComponent;
  let fixture: ComponentFixture<VaultBatchActionComponent>;

  const canAddToFolder = signal(false);
  const canAssignToCollections = signal(false);
  const canFavorite = signal(false);
  const favoriteAdds = signal(true);
  const progress = signal<{ done: number; total: number } | null>(null);
  const canEditCollectionAccess = signal(false);
  const canArchive = signal(false);
  const canUnarchive = signal(false);
  const canRestore = signal(false);
  const canDelete = signal(false);
  const inTrash = signal(false);
  const selectedCount = signal(0);
  const vfo1Enabled = signal(false);

  const clearSpy = jest.fn();
  const bulkMoveToFolderSpy = jest.fn();
  const bulkAssignToCollectionsSpy = jest.fn();
  const bulkFavoriteSpy = jest.fn();
  const bulkEditCollectionAccessSpy = jest.fn();
  const bulkArchiveSpy = jest.fn();
  const bulkUnarchiveSpy = jest.fn();
  const bulkRestoreSpy = jest.fn();
  const bulkDeleteSpy = jest.fn();

  beforeEach(async () => {
    canAddToFolder.set(false);
    canAssignToCollections.set(false);
    canFavorite.set(false);
    favoriteAdds.set(true);
    progress.set(null);
    canEditCollectionAccess.set(false);
    canArchive.set(false);
    canUnarchive.set(false);
    canRestore.set(false);
    canDelete.set(false);
    inTrash.set(false);
    selectedCount.set(0);
    vfo1Enabled.set(false);
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [VaultBatchActionComponent, NoopAnimationsModule],
      providers: [
        {
          provide: VaultBatchBarService,
          useValue: {
            selectedCount,
            canAddToFolder,
            canAssignToCollections,
            canFavorite,
            favoriteAdds,
            progress,
            canEditCollectionAccess,
            canArchive,
            canUnarchive,
            canRestore,
            canDelete,
            inTrash,
            clearSelection: clearSpy,
            bulkMoveToFolder: bulkMoveToFolderSpy,
            bulkAssignToCollections: bulkAssignToCollectionsSpy,
            bulkFavorite: bulkFavoriteSpy,
            bulkEditCollectionAccess: bulkEditCollectionAccessSpy,
            bulkArchive: bulkArchiveSpy,
            bulkUnarchive: bulkUnarchiveSpy,
            bulkRestore: bulkRestoreSpy,
            bulkDelete: bulkDeleteSpy,
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: (key: string, ...placeholders: Array<string | number>) =>
              [`translated-${key}`, ...placeholders].join(" "),
          },
        },
        {
          provide: Vfo1TerminologyService,
          useValue: { iconClass: (icon: string) => icon, enabled: vfo1Enabled },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VaultBatchActionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe("primaryActions", () => {
    it("is empty when no signals are true", () => {
      expect(component["primaryActions"]()).toHaveLength(0);
    });

    // Keykeeper: five actions stay buttons (upstream: three), so Delete is
    // not put away in the menu for everyone who belongs to an organization.
    it("includes all actions when total equals threshold (5)", () => {
      canAddToFolder.set(true);
      canAssignToCollections.set(true);
      canFavorite.set(true);
      canArchive.set(true);
      canDelete.set(true);

      expect(component["primaryActions"]()).toHaveLength(5);
      expect(component["overflowActions"]()).toHaveLength(0);
    });

    it("caps at 4 when total exceeds threshold (5)", () => {
      canAddToFolder.set(true);
      canAssignToCollections.set(true);
      canFavorite.set(true);
      canEditCollectionAccess.set(true);
      canArchive.set(true);
      canDelete.set(true);

      expect(component["primaryActions"]()).toHaveLength(4);
    });

    it("contains all actions when exactly 1 is enabled", () => {
      canDelete.set(true);

      expect(component["primaryActions"]()).toHaveLength(1);
      expect(component["overflowActions"]()).toHaveLength(0);
    });

    it("contains all actions when exactly 2 are enabled", () => {
      canAddToFolder.set(true);
      canDelete.set(true);

      expect(component["primaryActions"]()).toHaveLength(2);
      expect(component["overflowActions"]()).toHaveLength(0);
    });
  });

  describe("overflowActions", () => {
    it("is empty when total is at or below the threshold (5)", () => {
      canAddToFolder.set(true);
      canDelete.set(true);

      expect(component["overflowActions"]()).toHaveLength(0);
    });

    it("contains remaining actions when total is 6", () => {
      canAddToFolder.set(true);
      canAssignToCollections.set(true);
      canFavorite.set(true);
      canEditCollectionAccess.set(true);
      canArchive.set(true);
      canDelete.set(true);

      expect(component["overflowActions"]()).toHaveLength(2);
    });

    it("contains remaining actions when all 8 actions are enabled", () => {
      canAddToFolder.set(true);
      canAssignToCollections.set(true);
      canFavorite.set(true);
      canEditCollectionAccess.set(true);
      canArchive.set(true);
      canUnarchive.set(true);
      canRestore.set(true);
      canDelete.set(true);

      expect(component["primaryActions"]()).toHaveLength(4);
      expect(component["overflowActions"]()).toHaveLength(4);
    });

    it("keeps Delete last, whatever else is offered", () => {
      canAddToFolder.set(true);
      canAssignToCollections.set(true);
      canFavorite.set(true);
      canDelete.set(true);

      const labels = component["primaryActions"]().map((action) => action.label);
      expect(labels).toEqual([
        "translated-addToFolder",
        "translated-assignToCollections",
        "translated-favorite",
        "translated-delete",
      ]);
    });
  });

  describe("visibleActions labels and icons", () => {
    it("assigns the correct icon and translated label for move-to-folder", () => {
      canAddToFolder.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-folder");
      expect(action.label).toBe("translated-addToFolder");
    });

    it("assigns the correct icon and translated label for assign-to-collections", () => {
      canAssignToCollections.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-collection");
      expect(action.label).toBe("translated-assignToCollections");
    });

    it("offers Favorite with an empty star when it will add favorites", () => {
      canFavorite.set(true);
      favoriteAdds.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-star");
      expect(action.label).toBe("translated-favorite");
    });

    it("offers Unfavorite with a full star when every selected item is a favorite", () => {
      canFavorite.set(true);
      favoriteAdds.set(false);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-star-f");
      expect(action.label).toBe("translated-unfavorite");
    });

    it("says permanently delete in the trash", () => {
      canDelete.set(true);
      inTrash.set(true);

      const [action] = component["primaryActions"]();
      expect(action.label).toBe("translated-permanentlyDelete");
    });

    it("assigns the correct icon and translated label for edit-access", () => {
      canEditCollectionAccess.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-users");
      expect(action.label).toBe("translated-editAccess");
    });

    it("assigns the correct icon and translated label for archive", () => {
      canArchive.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-archive");
      expect(action.label).toBe("translated-archiveVerb");
    });

    it("assigns the correct icon and translated label for unarchive", () => {
      canUnarchive.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-unarchive");
      expect(action.label).toBe("translated-unArchive");
    });

    it("assigns the correct icon and translated label for restore", () => {
      canRestore.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-undo");
      expect(action.label).toBe("translated-restore");
    });

    it("assigns the correct icon and translated label for delete", () => {
      canDelete.set(true);

      const [action] = component["primaryActions"]();
      expect(action.icon).toBe("bwi-trash");
      expect(action.label).toBe("translated-delete");
    });
  });

  describe("action invocation", () => {
    it("clears through the service when the bar's Clear button is pressed", () => {
      selectedCount.set(2);

      const outlet = TestBed.createComponent(FooterOutletComponent);
      fixture.detectChanges();
      outlet.detectChanges();

      const clearButton = (outlet.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        "button[icon='bwi-clear']",
      );
      expect(clearButton).not.toBeNull();

      clearButton!.click();
      outlet.detectChanges();

      expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkMoveToFolder when move action is invoked", () => {
      canAddToFolder.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkMoveToFolderSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkAssignToCollections when assign action is invoked", () => {
      canAssignToCollections.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkAssignToCollectionsSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkFavorite when the favorite action is invoked", () => {
      canFavorite.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkFavoriteSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkEditCollectionAccess when edit-access action is invoked", () => {
      canEditCollectionAccess.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkEditCollectionAccessSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkArchive when archive action is invoked", () => {
      canArchive.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkArchiveSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkUnarchive when unarchive action is invoked", () => {
      canUnarchive.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkUnarchiveSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkRestore when restore action is invoked", () => {
      canRestore.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkRestoreSpy).toHaveBeenCalledTimes(1);
    });

    it("calls service.bulkDelete when delete action is invoked", () => {
      canDelete.set(true);

      component["primaryActions"]()[0].action();

      expect(bulkDeleteSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("the line above the bar", () => {
    it("says nothing when the selection has actions", () => {
      selectedCount.set(2);
      canDelete.set(true);

      expect(component["note"]()).toBe("");
    });

    it("says nothing when nothing is selected", () => {
      expect(component["note"]()).toBe("");
    });

    it("says why the bar is empty when no selected item may be changed", () => {
      selectedCount.set(2);

      expect(component["note"]()).toBe("translated-keykeeperBulkNothingAllowed");
    });

    it("says how far an action has got while it runs", () => {
      selectedCount.set(12);
      canFavorite.set(true);
      progress.set({ done: 3, total: 12 });

      expect(component["busy"]()).toBe(true);
      expect(component["note"]()).toBe("translated-keykeeperBulkProgress 3 12");
    });

    it("is not busy when no action is running", () => {
      expect(component["busy"]()).toBe(false);
    });

    it("turns the buttons off while an action runs", () => {
      selectedCount.set(2);
      canFavorite.set(true);
      canDelete.set(true);

      const outlet = TestBed.createComponent(FooterOutletComponent);
      fixture.detectChanges();
      outlet.detectChanges();

      const buttons = () =>
        Array.from(
          (outlet.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
            '[role="toolbar"] button[bitBulkActionButton]:not([icon="bwi-clear"]):not([icon="bwi-ellipsis-v"])',
          ),
        );
      expect(buttons().length).toBe(2);
      expect(buttons().every((button) => !button.disabled)).toBe(true);

      progress.set({ done: 0, total: 2 });
      fixture.detectChanges();
      outlet.detectChanges();

      expect(buttons().every((button) => button.disabled || button.ariaDisabled === "true")).toBe(
        true,
      );
    });
  });
});
