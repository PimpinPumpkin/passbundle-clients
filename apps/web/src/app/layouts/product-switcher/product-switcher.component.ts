import { AfterViewInit, ChangeDetectorRef, Component, Input } from "@angular/core";
import { map } from "rxjs";

import { ButtonType } from "@bitwarden/components";

import { ProductSwitcherService } from "./shared/product-switcher.service";
// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "product-switcher",
  templateUrl: "./product-switcher.component.html",
  standalone: false,
})
export class ProductSwitcherComponent implements AfterViewInit {
  /**
   * Passed to the product switcher's `bitIconButton`
   */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input()
  buttonType: ButtonType = "secondary";

  ngAfterViewInit() {
    /**
     * Resolves https://angular.io/errors/NG0100 [SM-403]
     *
     * Caused by `[bitMenuTriggerFor]="content?.menu"` in template
     */
    this.changeDetector.detectChanges();
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private productSwitcherService: ProductSwitcherService,
  ) {}

  // Keykeeper: no button when there's nothing to switch to, only the Password Manager, now that
  // the menu doesn't advertise organizations.
  protected readonly products$ = this.productSwitcherService.products$.pipe(
    map((products) => (products.bento.length + products.other.length > 1 ? products : null)),
  );
}
