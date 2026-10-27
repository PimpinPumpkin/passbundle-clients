import { AsyncPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { map } from "rxjs";

import { IconButtonModule, MenuModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import {
  KeykeeperPlaceEntry,
  VaultPopupListFiltersService,
} from "../../../services/vault-popup-list-filters.service";

/** An entry's glyph: a person for Personal, a building for an organization, folders for the rest. */
const ICONS: Record<KeykeeperPlaceEntry["kind"], string> = {
  personal: "bwi-user",
  organization: "bwi-business",
  folder: "bwi-folder",
  sharedFolder: "bwi-collection-shared",
};

/**
 * Keykeeper: the vault's folder filter, beside the category chips (DESIGN.md,
 * "Folders and permissions"): one button that opens every place an item
 * lives, grouped by owner as in the web vault's menu (Personal and its
 * folders, then each organization and its shared folders), each with how
 * many items it shows. Once one is picked, a chip under the categories says
 * which, and clears it. It replaces upstream's three filters (vault,
 * collection, folder), which it sets the same way.
 */
@Component({
  selector: "app-keykeeper-folder-filter",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, I18nPipe, IconButtonModule, MenuModule],
  template: `
    @let places = places$ | async;
    @if (places?.length) {
      <button
        type="button"
        bitIconButton="bwi-folder"
        size="small"
        buttonType="primaryGhost"
        [label]="'keykeeperFilterByFolder' | i18n"
        [bitMenuTriggerFor]="menu"
        [attr.data-picked]="(picked$ | async) ? true : null"
        data-testid="keykeeper-folder-filter"
      ></button>
      <bit-menu #menu [ariaLabel]="'keykeeperFolders' | i18n">
        <button
          type="button"
          bitMenuItem
          [attr.aria-current]="(picked$ | async) ? null : true"
          (click)="pick(null)"
          data-testid="keykeeper-place"
          data-place="all"
        >
          <i slot="start" class="bwi bwi-fw bwi-grid" aria-hidden="true"></i>
          {{ "keykeeperAllFolders" | i18n }}
        </button>
        @for (place of places; track place.key) {
          <button
            type="button"
            bitMenuItem
            [disabled]="place.disabled"
            [attr.aria-current]="place.picked ? true : null"
            [attr.data-place]="place.key"
            [attr.data-depth]="place.depth"
            [attr.data-owner]="place.depth === 0 || null"
            [style.padding-inline-start.px]="12 + place.depth * 16"
            (click)="pick(place)"
            data-testid="keykeeper-place"
          >
            <i slot="start" class="bwi bwi-fw {{ icon(place) }}" aria-hidden="true"></i>
            {{ place.label }}
            <span slot="end" data-kk="count">
              @if (place.picked) {
                <i class="bwi bwi-check" aria-hidden="true"></i>
              }
              {{ place.count }}
            </span>
          </button>
        }
      </bit-menu>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    button[data-picked] {
      color: var(--pb-brand, rgb(var(--color-primary-600)));
      background: var(--pb-brand-tint, transparent);
      border-radius: 9px;
    }
    [data-owner] {
      font-weight: 700;
    }
    [data-kk="count"] {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class KeykeeperFolderFilterComponent {
  private readonly filtersService = inject(VaultPopupListFiltersService);

  protected readonly places$ = this.filtersService.places$;
  protected readonly picked$ = this.filtersService.pickedPlace$.pipe(map((p) => p ?? null));

  protected icon(place: KeykeeperPlaceEntry): string {
    return ICONS[place.kind];
  }

  protected pick(place: KeykeeperPlaceEntry | null) {
    this.filtersService.pickPlace(place);
  }
}
