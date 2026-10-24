import { AsyncPipe } from "@angular/common";
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { combineLatest, distinctUntilChanged, map, startWith, tap } from "rxjs";

import { DomainSettingsService } from "@bitwarden/common/autofill/services/domain-settings.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { buildCipherIcon } from "@bitwarden/common/vault/icon/build-cipher-icon";
import {
  categoryOfItem,
  isServerFallbackIcon,
  tileLetter,
} from "@bitwarden/common/vault/keykeeper/categories";
import {
  CipherViewLike,
  CipherViewLikeUtils,
} from "@bitwarden/common/vault/utils/cipher-view-like-utils";

import { KeykeeperCategoryTileComponent } from "./category-tile.component";

/**
 * Keykeeper: an item's tile in lists and at the top of its page (DESIGN.md,
 * "The look"). A login shows its site's icon on a white tile when the server
 * has one, otherwise its first letter on a tint of the login color, so a list
 * is never a column of identical keys. Everything else, and items made from a
 * template with its own color, shows its category's jewel tile. Decorative:
 * the item's name is always beside it.
 */
@Component({
  selector: "vault-keykeeper-item-tile",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncPipe, KeykeeperCategoryTileComponent],
  template: `
    @let image = image$ | async;
    @if (category() === "login" && (letter() || image)) {
      <span
        data-site
        [attr.data-hero]="hero() || null"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.border-radius.px]="radius()"
        [attr.data-tile]="image && imageLoaded() ? 'site-icon' : 'letter'"
        aria-hidden="true"
      >
        @if (image) {
          <img
            [src]="image"
            alt=""
            decoding="async"
            loading="lazy"
            [style.width.px]="imageSize()"
            [style.height.px]="imageSize()"
            [attr.data-pending]="imageLoaded() ? null : ''"
            (load)="onImageLoad($any($event.target))"
            (error)="imageLoaded.set(false)"
          />
        }
        @if (!image || !imageLoaded()) {
          <span [style.font-size.px]="letterSize()">{{ letter() }}</span>
        }
      </span>
    } @else {
      <vault-keykeeper-category-tile
        [category]="category()"
        [size]="size()"
        [attr.data-tile]="'category'"
      />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    [data-site] {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      overflow: hidden;
      background: #e3e9f8;
      border: 1px solid #e3e9f8;
      color: #1d3c99;
      font-weight: 700;
      line-height: 1;
    }
    [data-site][data-tile="site-icon"] {
      background: #ffffff;
      border-color: #dce5e1;
    }
    [data-site][data-hero] {
      box-shadow: 0 4px 12px rgb(16 32 27 / 0.08);
    }
    img[data-pending] {
      position: absolute;
      visibility: hidden;
    }
    :host-context(.theme_dark) [data-site] {
      background: #1c2a4a;
      border-color: #1c2a4a;
      color: #9db4f2;
    }
    :host-context(.theme_dark) [data-site][data-tile="site-icon"] {
      background: #f4f7f6;
      border-color: #f4f7f6;
    }
    :host-context(.theme_dark) [data-site][data-hero] {
      box-shadow: 0 6px 16px rgb(0 0 0 / 0.35);
    }
    img {
      display: block;
      object-fit: contain;
    }
  `,
})
export class KeykeeperItemTileComponent {
  private readonly environmentService = inject(EnvironmentService);
  private readonly domainSettingsService = inject(DomainSettingsService);

  readonly cipher = input.required<CipherViewLike>();
  /** The big tile at the top of an item's page, instead of a list's. */
  readonly hero = input(false, { transform: booleanAttribute });

  protected readonly imageLoaded = signal(false);

  protected readonly size = computed(() => (this.hero() ? 52 : 36));
  protected readonly radius = computed(() => (this.hero() ? 14 : 10));
  protected readonly imageSize = computed(() => (this.hero() ? 30 : 22));
  protected readonly letterSize = computed(() => (this.hero() ? 24 : 16));

  protected readonly category = computed(() => {
    const cipher = this.cipher();
    return categoryOfItem({
      type: CipherViewLikeUtils.getType(cipher),
      fields: "fields" in cipher ? (cipher.fields as { name?: string; value?: string }[]) : null,
    });
  });

  protected readonly letter = computed(() => tileLetter(this.cipher().name));

  /**
   * The server answers with its own small globe when a site has no icon of
   * its own; that one counts as no icon, so the tile shows the letter.
   */
  protected onImageLoad(img: HTMLImageElement) {
    this.imageLoaded.set(!isServerFallbackIcon(img.naturalWidth, img.naturalHeight));
  }

  /** The site's icon from the server's icon service, when favicons are on. */
  protected readonly image$ = combineLatest([
    this.environmentService.environment$.pipe(map((env) => env.getIconsUrl())),
    this.domainSettingsService.showFavicons$,
    toObservable(this.cipher),
  ]).pipe(
    map(([iconsUrl, showFavicons, cipher]) => {
      const icon = buildCipherIcon(iconsUrl, cipher, showFavicons);
      return icon.imageEnabled ? icon.image : null;
    }),
    distinctUntilChanged(),
    tap(() => this.imageLoaded.set(false)),
    startWith(null),
  );
}
