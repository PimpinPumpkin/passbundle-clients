import { DatePipe, formatDate } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { itemLike } from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherId, UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { HIDDEN_VALUE_MASK, maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  AsyncActionsModule,
  BadgeComponent,
  ButtonModule,
  CardComponent,
  DialogService,
  IconButtonModule,
  ItemModule,
  LinkModule,
  SectionComponent,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";
import {
  CipherFormConfigService,
  DefaultCipherFormConfigService,
  DefaultCipherFormService,
  historyAccess,
  HistoryAccess,
  ItemVersion,
  KeykeeperItemHistoryService,
  KeykeeperItemTileComponent,
  PasswordRepromptService,
  restoreConfirmation,
  savedByLabel,
  VersionRow,
  versionRows,
} from "@bitwarden/vault";

import { PopupFooterComponent } from "../../../../../platform/popup/layout/popup-footer.component";
import { PopupHeaderComponent } from "../../../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../../../platform/popup/layout/popup-page.component";
import { PopupRouterCacheService } from "../../../../../platform/popup/view-cache/popup-router-cache.service";

/** Where the page is: loading, asking the master password, or showing. */
type PageState = "loading" | "refused" | "ready" | "failed";

/**
 * Keykeeper: an item's version history in the extension (DESIGN.md, "Item
 * history"), as the web vault and the apps have it: its earlier versions,
 * newest first, with when each was saved and by whom; one beside the item as
 * it is now, field by field, its hidden values masked until shown; restoring
 * one as a normal edit; and deleting one or clearing them all where the
 * server allows. Someone whose shared folders hide the item's passwords sees
 * when and by whom only. An item that asks for the master password asks
 * again before its history opens, as it does before the item does.
 */
@Component({
  selector: "app-keykeeper-item-history-page",
  templateUrl: "item-history-page.component.html",
  styles: `
    /* The history page in the look of the item page (DESIGN.md, "The look"):
       the item's tile and name on top, versions as a resting card of rows,
       and a version beside the item now as one card, a row per field, with
       what changed marked in topaz. */
    [data-kk="muted"] {
      font-size: 13px;
      line-height: 1.4;
      color: var(--pb-muted, rgb(var(--color-text-muted)));
    }
    [data-kk="item"] {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    [data-kk="item-text"] {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    [data-kk="list"] {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    [data-kk="icon"] {
      color: var(--pb-muted, rgb(var(--color-text-muted)));
    }
    [data-kk="version"] > [data-kk="muted"] {
      margin: 0 0 10px;
    }
    [data-kk="compare"] {
      display: block;
    }
    [data-kk="columns"],
    [data-kk="heading"] {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    [data-kk="heading"] {
      padding: 10px 14px 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--pb-muted, rgb(var(--color-text-muted)));
      border-bottom: 1px solid var(--pb-divider, rgb(var(--color-secondary-300)));
    }
    [data-kk="row"] {
      padding: 10px 14px;
      border-bottom: 1px solid var(--pb-divider, rgb(var(--color-secondary-100)));
      font-size: 14px;
    }
    [data-kk="row"]:last-child {
      border-bottom: 0;
    }
    [data-kk="row"] [role="cell"] {
      min-width: 0;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      font-size: 13px;
      color: var(--pb-text, rgb(var(--color-text-main)));
    }
    [data-kk="row"] [data-secret] {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      letter-spacing: 0.04em;
    }
    /* A changed field: a topaz edge, the color of a secure note's jewel. */
    [data-kk="row"][data-changed="true"] {
      box-shadow: inset 3px 0 0 #a9600c;
      background: rgb(169 96 12 / 0.07);
    }
    :host-context(.theme_dark) [data-kk="row"][data-changed="true"] {
      box-shadow: inset 3px 0 0 #e0a04a;
      background: rgb(224 160 74 / 0.1);
    }
    [data-kk="label"] {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 12px;
      font-weight: 600;
      color: var(--pb-label, rgb(var(--color-text-muted)));
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncActionsModule,
    BadgeComponent,
    ButtonModule,
    CardComponent,
    DatePipe,
    I18nPipe,
    IconButtonModule,
    ItemModule,
    KeykeeperItemTileComponent,
    LinkModule,
    PopupFooterComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    SectionComponent,
    TypographyModule,
  ],
  providers: [
    KeykeeperItemHistoryService,
    DefaultCipherFormService,
    { provide: CipherFormConfigService, useClass: DefaultCipherFormConfigService },
  ],
})
export class KeykeeperItemHistoryPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly accountService = inject(AccountService);
  private readonly cipherService = inject(CipherService);
  private readonly collectionService = inject(CollectionService);
  private readonly organizationService = inject(OrganizationService);
  private readonly historyService = inject(KeykeeperItemHistoryService);
  private readonly formService = inject(DefaultCipherFormService);
  private readonly formConfigService = inject(CipherFormConfigService);
  private readonly passwordRepromptService = inject(PasswordRepromptService);
  private readonly popupRouterCacheService = inject(PopupRouterCacheService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  private readonly locale = inject(LOCALE_ID);

  protected readonly state = signal<PageState>("loading");
  /** The item as it is now. */
  protected readonly cipher = signal<CipherView | null>(null);
  protected readonly access = signal<HistoryAccess>({ view: false, contents: false, clear: false });
  protected readonly versions = signal<ItemVersion[]>([]);
  protected readonly unreadable = signal(0);
  protected readonly hidePasswords = signal(false);
  /** The version shown beside the item, if one is open. */
  protected readonly open = signal<ItemVersion | null>(null);
  protected readonly reveal = signal(false);

  private readonly userId = signal<UserId | null>(null);

  /** The page's title; a version's date goes under it, where it has room. */
  protected readonly title = computed(() => this.i18nService.t("keykeeperVersionHistory"));

  /** Restoring needs edit and the item's passwords, and an item not in the trash. */
  protected readonly canRestore = computed(() => {
    const item = this.cipher();
    return (
      !!item &&
      item.edit &&
      maySeeSecrets(item) &&
      !item.isDeleted &&
      this.access().contents &&
      !this.hidePasswords()
    );
  });

  /** Hidden values show only to someone who can see the item's passwords. */
  protected readonly canSeeSecrets = computed(
    () => maySeeSecrets(this.cipher()) && !this.hidePasswords() && this.access().contents,
  );

  protected readonly rows = computed<VersionRow[]>(() => {
    const version = this.open()?.view;
    const item = this.cipher();
    if (!version || !item) {
      return [];
    }
    return versionRows(version, item, (key, ...args) =>
      this.i18nService.t(key, ...args.map(String)),
    );
  });
  protected readonly unchanged = computed(() => this.rows().every((row) => !row.changed));
  protected readonly hasSecrets = computed(() => this.rows().some((row) => row.secret));

  async ngOnInit() {
    try {
      const cipherId = this.route.snapshot.queryParamMap.get("cipherId");
      this.userId.set(await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId)));
      const item = await this.current(cipherId);
      if (item == null) {
        this.state.set("failed");
        return;
      }
      // As opening the item does: ask for the master password first.
      if (!(await this.passwordRepromptService.passwordRepromptCheck(item))) {
        this.state.set("refused");
        await this.popupRouterCacheService.back();
        return;
      }
      this.cipher.set(item);
      this.access.set(await this.accessTo(item));
      if (!this.access().view) {
        this.state.set("failed");
        return;
      }
      await this.load(item);
    } catch (e) {
      this.logService.error(e);
      this.state.set("failed");
    }
  }

  /** The item as the vault holds it now, decrypted. */
  private async current(cipherId: string | null): Promise<CipherView | null> {
    const userId = this.userId();
    if (!cipherId || !userId) {
      return null;
    }
    const views = await firstValueFrom(this.cipherService.cipherViews$(userId));
    return views?.find((c) => c.id === cipherId) ?? null;
  }

  private async accessTo(item: CipherView): Promise<HistoryAccess> {
    const userId = this.userId()!;
    const [collections, organizations] = await Promise.all([
      firstValueFrom(this.collectionService.decryptedCollections$(userId)),
      firstValueFrom(this.organizationService.organizations$(userId)),
    ]);
    const org = organizations.find((o) => o.id === item.organizationId);
    return historyAccess(itemLike(item), collections, !!org?.canEditAllCiphers);
  }

  private async load(item: CipherView) {
    this.state.set("loading");
    const loaded = await this.historyService.load(item);
    // Contents only with view item history and see passwords in one folder,
    // as the server decides; never more than the person's folders say.
    const hidden = loaded.hidePasswords || !this.access().contents;
    this.versions.set(
      hidden ? loaded.versions.map((v): ItemVersion => ({ ...v, view: null })) : loaded.versions,
    );
    this.unreadable.set(hidden ? 0 : loaded.unreadable);
    this.hidePasswords.set(hidden);
    this.state.set("ready");
  }

  protected when(version: ItemVersion): string {
    return formatDate(version.revisionDate, "medium", this.locale);
  }

  protected savedBy(version: ItemVersion): string | null {
    return savedByLabel(version.savedBy, this.userId(), (key, ...args) =>
      this.i18nService.t(key, ...args.map(String)),
    );
  }

  /** "Saved by Ana · 2 changes", or what's known of it. */
  protected details(version: ItemVersion): string {
    const parts: string[] = [];
    const who = this.savedBy(version);
    if (who) {
      parts.push(who);
    }
    const item = this.cipher();
    if (version.view && item) {
      const changes = versionRows(version.view, item, (key) => key).filter((r) => r.changed).length;
      parts.push(
        changes === 1
          ? this.i18nService.t("keykeeperOneChange")
          : this.i18nService.t("keykeeperChanges", changes),
      );
    }
    return parts.join(" · ");
  }

  protected openVersion(version: ItemVersion) {
    if (version.view == null) {
      return;
    }
    this.reveal.set(false);
    this.open.set(version);
  }

  /** A secret's value as the page shows it: masked until shown, and never for someone who can't see it. */
  protected shown(row: VersionRow, value: string): string {
    if (!row.secret || !value || (this.canSeeSecrets() && this.reveal())) {
      return value;
    }
    return HIDDEN_VALUE_MASK;
  }

  protected toggleReveal() {
    if (this.canSeeSecrets()) {
      this.reveal.set(!this.reveal());
    }
  }

  /** Back from a version to the list, or from the list to the item. */
  protected readonly back = async () => {
    if (this.open()) {
      this.open.set(null);
      this.reveal.set(false);
      return;
    }
    await this.popupRouterCacheService.back();
  };

  protected readonly restore = async () => {
    const version = this.open();
    const item = this.cipher();
    if (!version?.view || !item || !this.canRestore()) {
      return;
    }
    const confirmed = await this.dialogService.openSimpleDialog(
      restoreConfirmation(version.view, item, this.when(version)),
    );
    if (!confirmed) {
      return;
    }
    try {
      const config = await this.formConfigService.buildConfig(
        "edit",
        item.id as CipherId,
        item.type,
      );
      await this.historyService.restore(this.formService, version.view, item, config);
    } catch (e) {
      this.logService.error(e);
      this.toastService.showToast({
        variant: "error",
        // The server refuses a restore over an edit made since (a stale copy).
        message: this.i18nService.t("keykeeperRestoreFailed"),
      });
      return;
    }
    this.toastService.showToast({
      variant: "success",
      message: this.i18nService.t("keykeeperVersionRestored"),
    });
    this.open.set(null);
    await this.popupRouterCacheService.back();
  };

  protected readonly deleteVersion = async () => {
    const version = this.open();
    const item = this.cipher();
    if (!version || !item || !this.access().clear) {
      return;
    }
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "keykeeperDeleteVersionTitle" },
      content: { key: "keykeeperDeleteVersionDesc", placeholders: [this.when(version)] },
      acceptButtonText: { key: "delete" },
      type: "danger",
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.historyService.deleteVersion(item.id, version.id);
    } catch (e) {
      this.logService.error(e);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("errorOccurred"),
      });
      return;
    }
    this.toastService.showToast({
      variant: "success",
      message: this.i18nService.t("keykeeperVersionDeleted"),
    });
    this.open.set(null);
    await this.load(item);
  };

  protected readonly clear = async () => {
    const item = this.cipher();
    if (!item || !this.access().clear) {
      return;
    }
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "keykeeperClearHistoryTitle" },
      content: { key: "keykeeperClearHistoryDesc" },
      acceptButtonText: { key: "keykeeperClearHistory" },
      type: "danger",
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.historyService.clear(item.id);
      this.toastService.showToast({
        variant: "success",
        message: this.i18nService.t("keykeeperHistoryCleared"),
      });
    } catch (e) {
      this.logService.error(e);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("errorOccurred"),
      });
    }
    await this.load(item);
  };
}
