// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, inject, NgZone, ViewChild } from "@angular/core";
import { combineLatest, map, take } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  DisclosureComponent,
  DisclosureTriggerForDirective,
  IconButtonModule,
} from "@bitwarden/components";

import { runInsideAngular } from "../../../../../platform/browser/run-inside-angular.operator";
import { VaultPopupListFiltersService } from "../../../services/vault-popup-list-filters.service";
import { KeykeeperCategoryChipsComponent } from "../keykeeper-category-chips/keykeeper-category-chips.component";
import { VaultListFiltersComponent } from "../vault-list-filters/vault-list-filters.component";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-vault-header",
  templateUrl: "vault-header.component.html",
  imports: [
    KeykeeperCategoryChipsComponent,
    VaultListFiltersComponent,
    DisclosureComponent,
    IconButtonModule,
    DisclosureTriggerForDirective,
    CommonModule,
    JslibModule,
  ],
})
export class VaultHeaderComponent {
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @ViewChild(DisclosureComponent) disclosure: DisclosureComponent;

  /**
   * Emits the visibility status of the disclosure component. Keykeeper: closed
   * until someone opens it, since the chips above the list do the most common
   * filtering (by kind of item).
   */
  protected isDisclosureShown$ = this.vaultPopupListFiltersService.filterVisibilityState$.pipe(
    runInsideAngular(inject(NgZone)), // Browser state updates can happen outside of `ngZone`
    map((v) => v ?? false),
  );

  // Only use the first value to avoid an infinite loop from two-way binding
  protected initialDisclosureVisibility$ = this.isDisclosureShown$.pipe(take(1));

  /**
   * Keykeeper: the filters behind the button, the ones besides the kind of
   * item, which the chips show on their own.
   */
  protected numberOfAppliedFilters$ = this.vaultPopupListFiltersService.filters$.pipe(
    map(
      (filters) =>
        [filters.organization, filters.collection, filters.folder].filter(Boolean).length,
    ),
  );

  /** Keykeeper: the button shows only when there are vaults, collections, or folders to pick. */
  protected hasMoreFilters$ = this.vaultPopupListFiltersService.allFilters$.pipe(
    map((lists) => lists.some((list) => (list?.length ?? 0) > 0)),
  );

  /** Emits true when the number of filters badge should be applied. */
  protected showBadge$ = combineLatest([
    this.numberOfAppliedFilters$,
    this.isDisclosureShown$,
  ]).pipe(map(([numberOfFilters, disclosureShown]) => numberOfFilters !== 0 && !disclosureShown));

  protected buttonSupportingText$ = this.numberOfAppliedFilters$.pipe(
    map((numberOfFilters) => {
      if (numberOfFilters === 0) {
        return null;
      }
      if (numberOfFilters === 1) {
        return this.i18nService.t("filterApplied");
      }

      return this.i18nService.t("filterAppliedPlural", numberOfFilters);
    }),
  );

  constructor(
    private vaultPopupListFiltersService: VaultPopupListFiltersService,
    private i18nService: I18nService,
  ) {}

  async toggleFilters(isShown: boolean) {
    await this.vaultPopupListFiltersService.updateFilterVisibility(isShown);
  }
}
