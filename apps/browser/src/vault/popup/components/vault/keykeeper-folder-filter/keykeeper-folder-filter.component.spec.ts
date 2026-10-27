import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { BehaviorSubject } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import {
  KeykeeperPlaceEntry,
  VaultPopupListFiltersService,
} from "../../../services/vault-popup-list-filters.service";

import { KeykeeperFolderFilterComponent } from "./keykeeper-folder-filter.component";

const entry = (key: string, overrides: Partial<KeykeeperPlaceEntry>): KeykeeperPlaceEntry => ({
  key,
  kind: "folder",
  label: key,
  depth: 1,
  count: 0,
  picked: false,
  disabled: false,
  filters: { organization: null, collection: null, folder: null },
  ...overrides,
});

describe("KeykeeperFolderFilterComponent", () => {
  let fixture: ComponentFixture<KeykeeperFolderFilterComponent>;
  const places$ = new BehaviorSubject<KeykeeperPlaceEntry[]>([]);
  const picked$ = new BehaviorSubject<KeykeeperPlaceEntry | undefined>(undefined);
  const pickPlace = jest.fn();

  const places = [
    entry("personal", { kind: "personal", label: "Personal", depth: 0, count: 4 }),
    entry("folder:f-work", { label: "Work", count: 2 }),
    entry("folder:none", { label: "No folder", count: 2 }),
    entry("org:o-lake", { kind: "organization", label: "Lakeside Clinic", depth: 0, count: 3 }),
    entry("shared:c-everyone", { kind: "sharedFolder", label: "Everyone", count: 3 }),
  ];

  beforeEach(async () => {
    pickPlace.mockClear();
    places$.next(places);
    picked$.next(undefined);
    await TestBed.configureTestingModule({
      imports: [KeykeeperFolderFilterComponent, NoopAnimationsModule],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: VaultPopupListFiltersService,
          useValue: { places$, pickedPlace$: picked$, pickPlace },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KeykeeperFolderFilterComponent);
    fixture.detectChanges();
  });

  const button = () =>
    fixture.debugElement.query(By.css('[data-testid="keykeeper-folder-filter"]'));

  /** Opens the menu and returns its entries. */
  function openMenu(): HTMLElement[] {
    button().nativeElement.click();
    fixture.detectChanges();
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="keykeeper-place"]'));
  }

  afterEach(() => {
    // The menu lives in an overlay outside the fixture.
    document.querySelectorAll(".cdk-overlay-container").forEach((e) => (e.innerHTML = ""));
  });

  it("hides the button when there's nothing to pick but Personal", () => {
    places$.next([]);
    fixture.detectChanges();
    expect(button()).toBeNull();
  });

  it("lists every place grouped by owner, indented, with how many items each shows", () => {
    const entries = openMenu();
    expect(entries.map((e) => e.getAttribute("data-place"))).toEqual([
      "all",
      "personal",
      "folder:f-work",
      "folder:none",
      "org:o-lake",
      "shared:c-everyone",
    ]);
    const everyone = entries[5];
    expect(everyone.textContent).toContain("Everyone");
    expect(everyone.textContent).toContain("3");
    expect(everyone.style.paddingInlineStart).toBe("28px");
    expect(entries[4].hasAttribute("data-owner")).toBe(true);
  });

  it("picks a place, or all of them", () => {
    let entries = openMenu();
    entries[5].click();
    expect(pickPlace).toHaveBeenCalledWith(places[4]);

    entries = openMenu();
    entries[0].click();
    expect(pickPlace).toHaveBeenLastCalledWith(null);
  });

  it("marks the place picked, and the button", () => {
    places$.next(places.map((p) => (p.key === "folder:f-work" ? { ...p, picked: true } : p)));
    picked$.next(places[1]);
    fixture.detectChanges();
    expect(button().attributes["data-picked"]).toBe("true");
    const entries = openMenu();
    expect(entries[2].getAttribute("aria-current")).toBe("true");
    expect(entries[0].getAttribute("aria-current")).toBeNull();
  });

  it("can't pick Personal where a policy keeps items out of it", () => {
    places$.next(places.map((p) => (p.key === "personal" ? { ...p, disabled: true } : p)));
    fixture.detectChanges();
    const entries = openMenu();
    expect((entries[1] as HTMLButtonElement).disabled).toBe(true);
  });
});
