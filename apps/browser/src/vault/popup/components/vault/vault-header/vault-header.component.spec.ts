import { ChangeDetectionStrategy, Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { BehaviorSubject } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import {
  KeykeeperPlaceEntry,
  VaultPopupListFiltersService,
} from "../../../services/vault-popup-list-filters.service";
import { KeykeeperCategoryChipsComponent } from "../keykeeper-category-chips/keykeeper-category-chips.component";
import { KeykeeperFolderFilterComponent } from "../keykeeper-folder-filter/keykeeper-folder-filter.component";

import { VaultHeaderComponent } from "./vault-header.component";

@Component({
  selector: "app-keykeeper-category-chips",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class KeykeeperCategoryChipsStubComponent {}

@Component({
  selector: "app-keykeeper-folder-filter",
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class KeykeeperFolderFilterStubComponent {}

const place = (overrides: Partial<KeykeeperPlaceEntry>): KeykeeperPlaceEntry => ({
  key: "shared:c-everyone",
  kind: "sharedFolder",
  label: "Everyone",
  depth: 1,
  organizationId: "o-lake",
  collectionId: "c-everyone",
  count: 3,
  picked: true,
  disabled: false,
  filters: { organization: null, collection: null, folder: null },
  ownerName: "Lakeside Clinic",
  ...overrides,
});

describe("VaultHeaderComponent", () => {
  let fixture: ComponentFixture<VaultHeaderComponent>;
  const picked$ = new BehaviorSubject<KeykeeperPlaceEntry | undefined>(undefined);
  const pickPlace = jest.fn();

  beforeEach(async () => {
    pickPlace.mockClear();
    picked$.next(undefined);
    await TestBed.configureTestingModule({
      imports: [VaultHeaderComponent],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: VaultPopupListFiltersService,
          useValue: { pickedPlace$: picked$, pickPlace },
        },
      ],
    })
      .overrideComponent(VaultHeaderComponent, {
        remove: { imports: [KeykeeperCategoryChipsComponent, KeykeeperFolderFilterComponent] },
        add: { imports: [KeykeeperCategoryChipsStubComponent, KeykeeperFolderFilterStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(VaultHeaderComponent);
    fixture.detectChanges();
  });

  const chip = () => fixture.debugElement.query(By.css('[data-testid="keykeeper-picked-place"]'));

  it("shows the category chips and the folder filter side by side", () => {
    expect(fixture.debugElement.query(By.css("app-keykeeper-category-chips"))).not.toBeNull();
    expect(fixture.debugElement.query(By.css("app-keykeeper-folder-filter"))).not.toBeNull();
  });

  it("shows no chip until a place is picked", () => {
    expect(chip()).toBeNull();
  });

  it("names the picked shared folder with its organization, and clears it", () => {
    picked$.next(place({}));
    fixture.detectChanges();
    expect(chip().nativeElement.textContent).toContain("Lakeside Clinic · Everyone");
    expect(chip().query(By.css(".bwi-collection-shared"))).not.toBeNull();

    chip().query(By.css("button")).nativeElement.click();
    expect(pickPlace).toHaveBeenCalledWith(null);
  });

  it("names Personal and a personal folder by themselves", () => {
    picked$.next(
      place({ key: "personal", kind: "personal", label: "myVault", ownerName: undefined }),
    );
    fixture.detectChanges();
    expect(chip().nativeElement.textContent.trim()).toBe("myVault");
    expect(chip().query(By.css(".bwi-user"))).not.toBeNull();

    picked$.next(place({ key: "folder:f", kind: "folder", label: "Work", ownerName: undefined }));
    fixture.detectChanges();
    expect(chip().nativeElement.textContent.trim()).toBe("Work");
    expect(chip().query(By.css(".bwi-folder"))).not.toBeNull();
  });
});
