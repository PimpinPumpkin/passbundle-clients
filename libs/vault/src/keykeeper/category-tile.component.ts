import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

import {
  KEYKEEPER_CATEGORY_LOOKS,
  KeykeeperCategory,
} from "@bitwarden/common/vault/keykeeper/categories";

/**
 * Keykeeper: a category's jewel tile, a rounded square in the category's
 * color with its glyph in white and a little sheen (DESIGN.md, "The look").
 * Decorative: what it stands for is always written beside it.
 */
@Component({
  selector: "vault-keykeeper-category-tile",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      data-jewel
      [attr.data-flat]="flat() || null"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.border-radius.px]="radius()"
      [style.--pb-jewel]="look().light"
      [style.--pb-jewel-dark]="look().dark"
      [attr.data-category]="category()"
      aria-hidden="true"
    >
      <svg
        [attr.width]="glyphSize()"
        [attr.height]="glyphSize()"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#FFFFFF"
        [attr.stroke-width]="strokeWidth()"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path [attr.d]="look().glyph"></path>
      </svg>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    [data-jewel] {
      --pb-jewel-shine: rgb(255 255 255 / 0.32);
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      background:
        radial-gradient(120% 90% at 28% 18%, var(--pb-jewel-shine), rgb(255 255 255 / 0) 58%),
        var(--pb-jewel);
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.35),
        inset 0 -2px 3px rgb(0 0 0 / 0.2),
        0 1px 2px rgb(16 32 27 / 0.22);
    }
    [data-jewel][data-flat] {
      box-shadow: none;
    }
    :host-context(.theme_dark) [data-jewel] {
      --pb-jewel-shine: rgb(255 255 255 / 0.3);
      background:
        radial-gradient(120% 90% at 28% 18%, var(--pb-jewel-shine), rgb(255 255 255 / 0) 58%),
        var(--pb-jewel-dark);
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.32),
        inset 0 -2px 3px rgb(0 0 0 / 0.25);
    }
    :host-context(.theme_dark) [data-jewel][data-flat] {
      box-shadow: none;
    }
    svg {
      display: block;
    }
  `,
})
export class KeykeeperCategoryTileComponent {
  readonly category = input.required<KeykeeperCategory>();
  /** The tile's width and height, in pixels. */
  readonly size = input<number>(36);
  /** No shadows: for the tiny tiles inside chips and lines of text. */
  readonly flat = input(false, { transform: booleanAttribute });

  protected readonly look = computed(() => KEYKEEPER_CATEGORY_LOOKS[this.category()]);
  protected readonly radius = computed(() => Math.round(this.size() * 0.28));
  protected readonly glyphSize = computed(() => Math.round(this.size() * 0.58));
  protected readonly strokeWidth = computed(() => (this.size() <= 20 ? 2.4 : 1.9));
}
