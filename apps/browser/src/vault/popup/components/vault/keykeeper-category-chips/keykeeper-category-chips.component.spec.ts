import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { BehaviorSubject } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";

import { VaultPopupItemsService } from "../../../services/vault-popup-items.service";
import {
  PopupListFilter,
  VaultPopupListFiltersService,
} from "../../../services/vault-popup-list-filters.service";

import { KeykeeperCategoryChipsComponent } from "./keykeeper-category-chips.component";

describe("KeykeeperCategoryChipsComponent", () => {
  let fixture: ComponentFixture<KeykeeperCategoryChipsComponent>;
  let filterForm: ReturnType<FormBuilder["group"]>;
  let filters$: BehaviorSubject<PopupListFilter>;
  let typesWithItems$: BehaviorSubject<CipherType[]>;
  let expiringCount$: BehaviorSubject<number>;

  const emptyFilters: PopupListFilter = {
    organization: null,
    collection: null,
    folder: null,
    cipherType: null,
    keykeeperExpiring: false,
  };

  const chips = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("button")].map(
      (b) => ({
        label: b.textContent?.trim(),
        category: b.dataset.category,
        pressed: b.getAttribute("aria-pressed"),
      }),
    );

  beforeEach(async () => {
    filters$ = new BehaviorSubject(emptyFilters);
    expiringCount$ = new BehaviorSubject(0);
    typesWithItems$ = new BehaviorSubject([
      CipherType.Login,
      CipherType.SecureNote,
      CipherType.Card,
    ]);
    filterForm = new FormBuilder().group(emptyFilters);
    filterForm.valueChanges.subscribe((value) => filters$.next(value as PopupListFilter));

    await TestBed.configureTestingModule({
      imports: [KeykeeperCategoryChipsComponent],
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: VaultPopupListFiltersService,
          useValue: {
            filterForm,
            filters$,
            cipherTypes$: new BehaviorSubject(
              [
                [CipherType.Login, "typeLogin"],
                [CipherType.Card, "typeCard"],
                [CipherType.Identity, "typeIdentity"],
                [CipherType.SecureNote, "typeNote"],
                [CipherType.SshKey, "typeSshKey"],
              ].map(([value, label]) => ({ value, label })),
            ),
          },
        },
        {
          provide: VaultPopupItemsService,
          useValue: {
            keykeeperTypesWithItems$: typesWithItems$,
            keykeeperExpiringCount$: expiringCount$,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KeykeeperCategoryChipsComponent);
    fixture.detectChanges();
  });

  it("offers All, then each kind of item the vault has, with their categories", () => {
    expect(chips()).toEqual([
      { label: "all", category: "all", pressed: "true" },
      { label: "logins", category: "login", pressed: "false" },
      { label: "cards", category: "card", pressed: "false" },
      { label: "notes", category: "note", pressed: "false" },
    ]);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[role="group"]')
        ?.getAttribute("aria-label"),
    ).toBe("keykeeperCategories");
  });

  it("filters the list by the kind picked, and All clears it", () => {
    const button = (label: string) =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
      )!;

    button("cards").click();
    fixture.detectChanges();
    expect(filterForm.value.cipherType).toBe(CipherType.Card);
    expect(chips().find((c) => c.label === "cards")?.pressed).toBe("true");
    expect(chips().find((c) => c.label === "all")?.pressed).toBe("false");

    button("all").click();
    fixture.detectChanges();
    expect(filterForm.value.cipherType).toBeNull();
  });

  it("keeps the kind picked even when none of it is left", () => {
    filterForm.patchValue({ cipherType: CipherType.SshKey });
    fixture.detectChanges();

    expect(chips().map((c) => c.label)).toContain("sshKeys");
  });

  it("shows no chips when the vault has only one kind of item", () => {
    typesWithItems$.next([CipherType.Login]);
    fixture.detectChanges();

    expect(chips()).toEqual([]);
  });

  it("offers Expiring soon last while something expires, one chip at a time", () => {
    const button = (label: string) =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
      )!;
    expect(chips().map((c) => c.label)).not.toContain("keykeeperExpiringSoon");

    expiringCount$.next(2);
    fixture.detectChanges();
    expect(chips().at(-1)).toEqual({
      label: "keykeeperExpiringSoon",
      category: "expiring",
      pressed: "false",
    });

    button("cards").click();
    button("keykeeperExpiringSoon").click();
    fixture.detectChanges();
    expect(filterForm.value).toMatchObject({ cipherType: null, keykeeperExpiring: true });
    expect(
      chips()
        .filter((c) => c.pressed === "true")
        .map((c) => c.label),
    ).toEqual(["keykeeperExpiringSoon"]);

    // Still there once nothing's left in it, while it's picked.
    expiringCount$.next(0);
    fixture.detectChanges();
    expect(chips().at(-1)?.label).toBe("keykeeperExpiringSoon");

    button("logins").click();
    fixture.detectChanges();
    expect(filterForm.value).toMatchObject({
      cipherType: CipherType.Login,
      keykeeperExpiring: false,
    });
  });

  it("shows Expiring soon even with only one kind of item", () => {
    typesWithItems$.next([CipherType.Login]);
    expiringCount$.next(1);
    fixture.detectChanges();

    expect(chips().map((c) => c.label)).toEqual(["all", "logins", "keykeeperExpiringSoon"]);
  });
});
