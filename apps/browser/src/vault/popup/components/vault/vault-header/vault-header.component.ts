import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { IconButtonModule } from "@bitwarden/components";

import {
  KeykeeperPlaceEntry,
  VaultPopupListFiltersService,
} from "../../../services/vault-popup-list-filters.service";
import { KeykeeperCategoryChipsComponent } from "../keykeeper-category-chips/keykeeper-category-chips.component";
import { KeykeeperFolderFilterComponent } from "../keykeeper-folder-filter/keykeeper-folder-filter.component";

/**
 * Keykeeper: the vault's filters above the list: the category chips, the
 * folder filter (every place an item lives, grouped by owner), and the place
 * picked, as a chip that clears it (DESIGN.md, "Folders and permissions").
 */
@Component({
  selector: "app-vault-header",
  templateUrl: "vault-header.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    KeykeeperCategoryChipsComponent,
    KeykeeperFolderFilterComponent,
    IconButtonModule,
    CommonModule,
    JslibModule,
  ],
  styles: `
    [data-kk="picked"] {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      min-width: 0;
      height: 30px;
      padding: 0 2px 0 10px;
      border-radius: 15px;
      background: var(--pb-chip, rgb(var(--color-background)));
      color: var(--pb-chip-text, rgb(var(--color-text-main)));
      box-shadow: var(--pb-chip-shadow, 0 0 0 1px rgb(var(--color-secondary-300)));
      font-size: 13px;
      font-weight: 600;
    }
  `,
})
export class VaultHeaderComponent {
  private readonly vaultPopupListFiltersService = inject(VaultPopupListFiltersService);

  /** Keykeeper: the place the list shows, if one is picked. */
  protected readonly pickedPlace$ = this.vaultPopupListFiltersService.pickedPlace$;

  protected placeIcon(place: KeykeeperPlaceEntry): string {
    switch (place.kind) {
      case "personal":
        return "bwi-user";
      case "organization":
        return "bwi-business";
      case "sharedFolder":
        return "bwi-collection-shared";
      default:
        return "bwi-folder";
    }
  }

  /** "Contoso IT · Servers" for a shared folder; the place's name otherwise. */
  protected placeLabel(place: KeykeeperPlaceEntry): string {
    return place.ownerName ? `${place.ownerName} · ${place.label}` : place.label;
  }

  protected clearPlace() {
    this.vaultPopupListFiltersService.pickPlace(null);
  }
}
