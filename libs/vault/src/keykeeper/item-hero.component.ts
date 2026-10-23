import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { CollectionView } from "@bitwarden/common/admin-console/models/collections";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { categoryOfItem } from "@bitwarden/common/vault/keykeeper/categories";
import { templateOf } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { KeykeeperCategoryTileComponent } from "./category-tile.component";
import { KeykeeperItemTileComponent } from "./item-tile.component";

const KIND_KEYS: Record<CipherType, string> = {
  [CipherType.Login]: "typeLogin",
  [CipherType.SecureNote]: "typeNote",
  [CipherType.Card]: "typeCard",
  [CipherType.Identity]: "typeIdentity",
  [CipherType.SshKey]: "typeSshKey",
  [CipherType.BankAccount]: "typeBankAccount",
  [CipherType.DriversLicense]: "typeDriversLicense",
  [CipherType.Passport]: "typePassport",
};

/**
 * Keykeeper: the top of an item's page in the extension (DESIGN.md, "The
 * look"): its big tile, its name, and what it is and where it lives ("Login
 * in My vault", with the category's tiny tile), then whatever the page puts
 * under it, such as Fill on this page. Takes the place of upstream's details
 * card there.
 */
@Component({
  selector: "vault-keykeeper-item-hero",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KeykeeperCategoryTileComponent, KeykeeperItemTileComponent],
  template: `
    <div data-part="hero" data-testid="keykeeper-item-hero">
      <vault-keykeeper-item-tile [cipher]="cipher()" hero />
      <div data-part="text">
        <h1 data-part="name" data-testid="item-name">{{ cipher().name }}</h1>
        <span data-part="where" data-testid="keykeeper-item-where">
          <vault-keykeeper-category-tile [category]="category()" [size]="16" flat />
          <span data-part="where-text">{{ where() }}</span>
        </span>
      </div>
    </div>
    <ng-content></ng-content>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 12px;
    }
    [data-part="hero"] {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 4px 4px 2px;
      min-width: 0;
    }
    [data-part="text"] {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    [data-part="name"] {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
      font-weight: 700;
      color: var(--pb-text, rgb(var(--color-text-main)));
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      user-select: text;
    }
    [data-part="where"] {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      font-size: 13px;
      color: var(--pb-muted, rgb(var(--color-text-muted)));
    }
    [data-part="where-text"] {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class KeykeeperItemHeroComponent {
  private readonly i18nService = inject(I18nService);

  readonly cipher = input.required<CipherView>();
  readonly organization = input<Organization | undefined | null>(null);
  readonly folder = input<FolderView | undefined | null>(null);
  readonly collections = input<CollectionView[] | undefined | null>(null);

  protected readonly category = computed(() => categoryOfItem(this.cipher()));

  /**
   * "Login in My vault", or the template's name for an item made from one,
   * then its folder or collections: "Wi-Fi network in Contoso IT · Office".
   */
  protected readonly where = computed(() => {
    const cipher = this.cipher();
    const kind = templateOf(cipher)?.name ?? this.i18nService.t(KIND_KEYS[cipher.type]);
    const vault = this.organization()?.name ?? this.i18nService.t("myVault");
    const placed = [
      ...(this.folder()?.id ? [this.folder()!.name] : []),
      ...(this.collections() ?? []).map((c) => c.name),
    ].filter(Boolean);
    const line = this.i18nService.t("keykeeperItemInVault", kind, vault);
    return placed.length ? `${line} · ${placed.join(", ")}` : line;
  });
}
