import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import {
  KEYKEEPER_CATEGORY_LOOKS,
  KeykeeperCategory,
  KeykeeperCategoryLook,
  tileTint,
} from "@bitwarden/common/vault/keykeeper/categories";

/**
 * Keykeeper: a category's tile, flat: a rounded square tinted with the
 * category's tone and its glyph in the tone itself, lighter in dark mode, with
 * no sheen or shadow (DESIGN.md, "The look"); or a tile with a look of its
 * own, such as a Health report's. Only the logo's tile is glossy. Decorative:
 * what it stands for is always written beside it.
 */
@Component({
  selector: "vault-keykeeper-category-tile",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      data-jewel
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.border-radius.px]="radius()"
      [style.--pb-jewel]="drawn().light"
      [style.--pb-jewel-dark]="drawn().dark"
      [style.--pb-jewel-tint]="tint().light"
      [style.--pb-jewel-tint-dark]="tint().dark"
      [attr.data-category]="category() ?? null"
      aria-hidden="true"
    >
      <svg
        [attr.width]="glyphSize()"
        [attr.height]="glyphSize()"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        [attr.stroke-width]="strokeWidth()"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path [attr.d]="drawn().glyph"></path>
      </svg>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    [data-jewel] {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      color: var(--pb-jewel);
      background: var(--pb-jewel-tint);
    }
    :host-context(.theme_dark) [data-jewel] {
      color: var(--pb-jewel-dark);
      background: var(--pb-jewel-tint-dark);
    }
    svg {
      display: block;
    }
  `,
})
export class KeykeeperCategoryTileComponent {
  readonly category = input<KeykeeperCategory>();
  /** A color and glyph of its own, instead of a category's. */
  readonly look = input<KeykeeperCategoryLook>();
  /** The tile's width and height, in pixels. */
  readonly size = input<number>(36);

  protected readonly drawn = computed(
    () => this.look() ?? KEYKEEPER_CATEGORY_LOOKS[this.category() ?? "all"],
  );
  protected readonly tint = computed(() => ({
    light: tileTint(this.drawn(), "light"),
    dark: tileTint(this.drawn(), "dark"),
  }));
  protected readonly radius = computed(() => Math.round(this.size() * 0.28));
  protected readonly glyphSize = computed(() => Math.round(this.size() * 0.58));
  protected readonly strokeWidth = computed(() => (this.size() <= 20 ? 2.4 : 1.9));
}
