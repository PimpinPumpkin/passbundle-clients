import { AsyncPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { combineLatest, map } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { categoryOfType, KeykeeperCategory } from "@bitwarden/common/vault/keykeeper/categories";
import { I18nPipe } from "@bitwarden/ui-common";
import { KeykeeperCategoryTileComponent } from "@bitwarden/vault";

import { VaultPopupItemsService } from "../../../services/vault-popup-items.service";
import { VaultPopupListFiltersService } from "../../../services/vault-popup-list-filters.service";

export type KeykeeperCategoryChip = {
  type: CipherType | null;
  category: KeykeeperCategory;
  label: string;
  selected: boolean;
};

/** The chips' names, in the plural, where upstream has one. */
const PLURAL_KEYS: Partial<Record<CipherType, string>> = {
  [CipherType.Login]: "logins",
  [CipherType.Card]: "cards",
  [CipherType.Identity]: "identities",
  [CipherType.SecureNote]: "notes",
  [CipherType.SshKey]: "sshKeys",
};

/**
 * Keykeeper: the row of category chips under the vault's search (DESIGN.md,
 * "The look"): All, then each kind of item the vault has, each with its jewel
 * tile. Picking one filters the list by that kind, the same filter as
 * upstream's Type menu, which it replaces.
 */
@Component({
  selector: "app-keykeeper-category-chips",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, I18nPipe, KeykeeperCategoryTileComponent],
  template: `
    @let chips = chips$ | async;
    @if (chips?.length) {
      <div role="group" [attr.aria-label]="'keykeeperCategories' | i18n">
        @for (chip of chips; track chip.type) {
          <button
            type="button"
            [attr.aria-pressed]="chip.selected"
            [attr.data-category]="chip.category"
            data-testid="category-chip"
            (click)="pick(chip.type)"
          >
            <vault-keykeeper-category-tile [category]="chip.category" [size]="20" flat />
            {{ chip.label }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    [role="group"] {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
      /* Room for the picked chip's ring and the focus ring. */
      padding: 3px;
      margin: -3px;
    }
    [role="group"]::-webkit-scrollbar {
      display: none;
    }
    button {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 10px 0 6px;
      border: 0;
      border-radius: 16px;
      background: transparent;
      color: var(--pb-label, rgb(var(--color-text-muted)));
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    button:hover {
      background: var(--pb-hover, rgb(0 0 0 / 0.05));
    }
    button[aria-pressed="true"] {
      background: var(--pb-raised, rgb(var(--color-background)));
      color: var(--pb-text, rgb(var(--color-text-main)));
      box-shadow: var(--pb-chip-shadow, 0 0 0 1px rgb(var(--color-secondary-300)));
    }
    button:focus-visible {
      outline: 2px solid var(--pb-focus, rgb(var(--color-primary-600)));
      outline-offset: 1px;
    }
  `,
})
export class KeykeeperCategoryChipsComponent {
  private readonly filtersService = inject(VaultPopupListFiltersService);
  private readonly itemsService = inject(VaultPopupItemsService);
  private readonly i18nService = inject(I18nService);

  /**
   * All, then the kinds of item the vault has (and the one picked, even when
   * none are left). Nothing when there's only one kind to show.
   */
  protected readonly chips$ = combineLatest([
    this.filtersService.cipherTypes$,
    this.itemsService.keykeeperTypesWithItems$,
    this.filtersService.filters$,
  ]).pipe(
    map(([options, present, filters]): KeykeeperCategoryChip[] => {
      const picked = filters.cipherType ?? null;
      const kinds = options.filter((o) => present.includes(o.value) || o.value === picked);
      if (kinds.length < 2 && picked == null) {
        return [];
      }
      return [
        { type: null, category: "all", label: this.i18nService.t("all"), selected: picked == null },
        ...kinds.map((option) => ({
          type: option.value,
          category: categoryOfType(option.value),
          label: PLURAL_KEYS[option.value]
            ? this.i18nService.t(PLURAL_KEYS[option.value]!)
            : option.label,
          selected: option.value === picked,
        })),
      ];
    }),
  );

  protected pick(type: CipherType | null) {
    this.filtersService.filterForm.patchValue({ cipherType: type });
  }
}
