import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { combineLatest, from, map, switchMap } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import {
  categoryOfItem,
  categoryOfType,
  KeykeeperCategory,
} from "@bitwarden/common/vault/keykeeper/categories";
import { RestrictedItemTypesService } from "@bitwarden/common/vault/services/restricted-item-types.service";
import {
  CIPHER_MENU_ITEMS,
  DIALOG_CIPHER_MENU_ITEMS,
} from "@bitwarden/common/vault/types/cipher-menu-items";
import {
  ButtonModule,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
  LinkModule,
  TypographyModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { KeykeeperCategoryTileComponent } from "./category-tile.component";
import {
  BUILT_IN_TEMPLATES,
  ItemTemplate,
  TemplateBase,
  templateCipherType,
  templateFields,
  templateGroups,
} from "./templates";

/** What the person picked: a kind of item, a template, a new template, or a container. */
export type NewItemResult =
  | { kind: "type"; cipherType: CipherType }
  | { kind: "template"; template: ItemTemplate }
  | { kind: "createTemplate"; base: TemplateBase }
  | { kind: "folder" }
  | { kind: "collection" };

export type NewItemDialogData = {
  canCreateCipher: boolean;
  canCreateFolder: boolean;
  canCreateCollection: boolean;
  canCreateSshKey: boolean;
};

/** The kinds people save most, as big tiles; everything else is under More. */
const MAIN_TYPES: readonly CipherType[] = [
  CipherType.Login,
  CipherType.SecureNote,
  CipherType.Card,
  CipherType.Identity,
];

type Choice = { key: string; name: string; category: KeykeeperCategory; result: NewItemResult };

/**
 * Keykeeper: the New item picker (DESIGN.md, "Our own screens"). The kinds
 * people save most first, as big tiles; "More categories" opens the rest of
 * the item types and the templates (built-in, the person's, and their
 * organizations'), with a search. Folders and collections, which aren't
 * items, are buttons at the bottom. Every kind and template shows its jewel
 * tile, as in the menu and the list (DESIGN.md, "The look").
 */
@Component({
  selector: "vault-keykeeper-new-item-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonModule,
    DialogModule,
    I18nPipe,
    KeykeeperCategoryTileComponent,
    LinkModule,
    TypographyModule,
  ],
  template: `
    <bit-dialog dialogSize="large" background="alt">
      <span bitDialogTitle>What are you saving?</span>
      <div bitDialogContent class="tw-flex tw-flex-col tw-gap-5">
        @if (data.canCreateCipher) {
          <div
            class="tw-grid tw-grid-cols-2 tw-gap-3 md:tw-grid-cols-4"
            data-testid="new-item-main"
          >
            @for (t of main(); track t.type) {
              <button
                type="button"
                class="tw-flex tw-min-h-32 tw-flex-col tw-items-start tw-gap-2 tw-rounded-xl tw-border tw-border-solid tw-border-secondary-300 tw-bg-background tw-p-4 tw-text-start tw-text-main hover:tw-border-primary-600 focus-visible:tw-outline-primary-600"
                (click)="close({ kind: 'type', cipherType: t.type })"
              >
                <vault-keykeeper-category-tile [category]="t.category" [size]="36" />
                <span class="tw-font-semibold">{{ t.labelKey | i18n }}</span>
                <span bitTypography="helper" class="tw-text-muted">{{ t.subtitleKey | i18n }}</span>
              </button>
            }
          </div>

          @if (showMore()) {
            <section class="tw-flex tw-flex-col tw-gap-3" aria-label="More categories">
              <div class="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
                <h2 bitTypography="h5" class="tw-m-0 tw-flex-1">More categories</h2>
                <label for="new-item-search" class="tw-sr-only">Find a category</label>
                <input
                  id="new-item-search"
                  type="search"
                  placeholder="Find a category"
                  class="tw-h-9 tw-w-56 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-bg-background tw-px-3 tw-text-main"
                  [value]="query()"
                  (input)="query.set($any($event.target).value)"
                />
              </div>
              <div class="tw-grid tw-grid-cols-2 tw-gap-2 md:tw-grid-cols-3">
                @for (c of more(); track c.key) {
                  <button
                    type="button"
                    class="tw-flex tw-items-center tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-bg-background tw-px-3 tw-py-2 tw-text-start tw-text-main hover:tw-border-primary-600"
                    (click)="close(c.result)"
                  >
                    <vault-keykeeper-category-tile [category]="c.category" [size]="24" />
                    {{ c.name }}
                  </button>
                } @empty {
                  <p bitTypography="body2" class="tw-col-span-full tw-m-0 tw-text-muted">
                    No category matches that.
                  </p>
                }
              </div>
              @for (group of templateGroups(); track group.name) {
                <section [attr.aria-label]="group.name" class="tw-flex tw-flex-col tw-gap-2">
                  <h2 bitTypography="h6" class="tw-m-0">{{ group.name }}</h2>
                  <div class="tw-grid tw-grid-cols-2 tw-gap-2 md:tw-grid-cols-3">
                    @for (c of group.choices; track c.key) {
                      <button
                        type="button"
                        class="tw-flex tw-items-center tw-gap-3 tw-rounded-lg tw-border tw-border-dashed tw-border-secondary-300 tw-bg-background tw-px-3 tw-py-2 tw-text-start tw-text-main hover:tw-border-primary-600"
                        (click)="close(c.result)"
                      >
                        <vault-keykeeper-category-tile [category]="c.category" [size]="24" />
                        {{ c.name }}
                      </button>
                    }
                  </div>
                </section>
              }
              <p bitTypography="body2" class="tw-m-0">
                Make your own:
                <button
                  type="button"
                  bitLink
                  (click)="close({ kind: 'createTemplate', base: 'login' })"
                >
                  a template for logins
                </button>
                or
                <button
                  type="button"
                  bitLink
                  (click)="close({ kind: 'createTemplate', base: 'note' })"
                >
                  for notes</button
                >.
              </p>
            </section>
          }
          <div>
            <button
              type="button"
              bitButton
              buttonType="secondary"
              [startIcon]="showMore() ? 'bwi-angle-up' : 'bwi-angle-down'"
              [attr.aria-expanded]="showMore()"
              (click)="showMore.set(!showMore())"
            >
              {{ showMore() ? "Fewer categories" : "More categories" }}
            </button>
          </div>
        }
      </div>
      <ng-container bitDialogFooter>
        @if (data.canCreateFolder) {
          <button
            type="button"
            bitButton
            buttonType="secondary"
            startIcon="bwi-folder"
            (click)="close({ kind: 'folder' })"
          >
            {{ "folder" | i18n }}
          </button>
        }
        @if (data.canCreateCollection) {
          <button
            type="button"
            bitButton
            buttonType="secondary"
            startIcon="bwi-collection-shared"
            (click)="close({ kind: 'collection' })"
          >
            {{ "collection" | i18n }}
          </button>
        }
        <button type="button" bitButton buttonType="secondary" bitDialogClose>
          {{ "cancel" | i18n }}
        </button>
      </ng-container>
    </bit-dialog>
  `,
})
export class KeykeeperNewItemDialogComponent {
  protected readonly data = inject<NewItemDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject<DialogRef<NewItemResult>>(DialogRef);
  private readonly i18nService = inject(I18nService);
  private readonly cipherService = inject(CipherService);
  private readonly organizationService = inject(OrganizationService);

  protected readonly showMore = signal(false);
  protected readonly query = signal("");

  private readonly restricted = toSignal(inject(RestrictedItemTypesService).restricted$, {
    initialValue: [],
  });
  /** Bank accounts, driver's licenses, and passports, where the server has them. */
  private readonly newItemTypes = toSignal(
    inject(ConfigService).getFeatureFlag$(FeatureFlag.PM32009NewItemTypes),
    { initialValue: false },
  );
  private readonly groups = toSignal(
    inject(AccountService).activeAccount$.pipe(
      getUserId,
      switchMap((userId) =>
        combineLatest([
          from(this.cipherService.getAllDecrypted(userId)),
          this.organizationService.organizations$(userId),
        ]),
      ),
      map(([items, organizations]) => templateGroups(items, organizations)),
    ),
    { initialValue: [{ name: "Built-in", templates: BUILT_IN_TEMPLATES }] },
  );

  private readonly allowedTypes = computed(() =>
    (this.newItemTypes() ? DIALOG_CIPHER_MENU_ITEMS : CIPHER_MENU_ITEMS)
      .filter(
        (item) =>
          (item.type !== CipherType.SshKey || this.data.canCreateSshKey) &&
          !this.restricted().some((r) => r.cipherType === item.type),
      )
      // "Secure note" either way (upstream's menu says "Note").
      .map((item) =>
        item.type === CipherType.SecureNote ? { ...item, labelKey: "typeSecureNote" } : item,
      ),
  );

  protected readonly main = computed(() =>
    MAIN_TYPES.map((type) => this.allowedTypes().find((item) => item.type === type))
      .filter((item) => item != null)
      .map((item) => ({ ...item, category: categoryOfType(item.type) })),
  );

  private readonly matches = (name: string) =>
    name.toLowerCase().includes(this.query().trim().toLowerCase());

  /** The other item types and the built-in templates, together, by name. */
  protected readonly more = computed<Choice[]>(() => {
    const types: Choice[] = this.allowedTypes()
      .filter((item) => !MAIN_TYPES.includes(item.type))
      .map((item) => ({
        key: `type-${item.type}`,
        name: this.i18nService.t(item.labelKey),
        category: categoryOfType(item.type),
        result: { kind: "type", cipherType: item.type },
      }));
    const builtIn = this.data.canCreateCipher ? this.templateChoices(BUILT_IN_TEMPLATES) : [];
    return [...types, ...builtIn]
      .filter((c) => this.matches(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** The person's and their organizations' templates, by group. */
  protected readonly templateGroups = computed(() =>
    this.groups()
      .filter((group) => group.templates !== BUILT_IN_TEMPLATES)
      .map((group) => ({
        name: group.name,
        choices: this.templateChoices(group.templates).filter((c) => this.matches(c.name)),
      }))
      .filter((group) => group.choices.length > 0),
  );

  private templateChoices(templates: readonly ItemTemplate[]): Choice[] {
    return templates.map((template) => ({
      key: `template-${template.source?.cipherId ?? template.id}`,
      name: template.name,
      category: categoryOfItem({
        type: templateCipherType(template),
        fields: templateFields(template),
      }),
      result: { kind: "template", template },
    }));
  }

  protected close(result: NewItemResult) {
    void this.dialogRef.close(result);
  }

  static open(dialogService: DialogService, data: NewItemDialogData) {
    return dialogService.open<NewItemResult, NewItemDialogData>(KeykeeperNewItemDialogComponent, {
      data,
    });
  }
}
