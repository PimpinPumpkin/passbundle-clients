import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  resource,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { firstValueFrom, map } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { maySeeSecrets } from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  CardComponent,
  DialogService,
  LinkModule,
  SectionComponent,
  SectionHeaderComponent,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { CipherFormConfig } from "../cipher-form/abstractions/cipher-form-config.service";
import { DefaultCipherFormService } from "../cipher-form/services/default-cipher-form.service";

import { ItemVersion, KeykeeperItemHistoryService } from "./item-history.service";
import { savedByLabel, VERSION_TIME_FORMAT } from "./item-versions";
import { KeykeeperVersionDialogComponent, VersionDialogResult } from "./version-dialog.component";

export type { ItemVersion } from "./item-history.service";

/** How many versions show before "Show all". */
const FIRST_VERSIONS = 5;

/**
 * Keykeeper: the item's earlier versions in its view, newest first, each with
 * when it was saved and by whom. "View" shows a version next to the item now,
 * with what changed marked, to restore or delete it; people who can delete
 * the item can clear its history (DESIGN.md, "Item history"). Nothing shows
 * until the item has an earlier version.
 */
@Component({
  selector: "app-keykeeper-item-versions",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    I18nPipe,
    CardComponent,
    LinkModule,
    SectionComponent,
    SectionHeaderComponent,
    TypographyModule,
  ],
  providers: [DefaultCipherFormService, KeykeeperItemHistoryService],
  template: `
    @if (versions().length > 0) {
      <bit-section
        disableMargin
        class="tw-mt-5 tw-block bit-compact:tw-mt-4"
        data-testid="keykeeper-item-versions"
      >
        <bit-section-header>
          <h2 bitTypography="h6">{{ "keykeeperVersionHistory" | i18n }}</h2>
        </bit-section-header>
        <bit-card>
          <p
            bitTypography="helper"
            class="tw-mb-2 tw-text-muted"
            data-testid="keykeeper-versions-who"
          >
            {{
              (hidePasswords()
                ? "keykeeperVersionHistoryHiddenPasswords"
                : "keykeeperVersionHistoryWhoSees"
              ) | i18n
            }}
          </p>
          <ul
            class="tw-m-0 tw-list-none tw-p-0"
            [attr.aria-label]="'keykeeperVersionHistory' | i18n"
          >
            @for (version of shown(); track version.id; let last = $last) {
              <li
                class="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-py-2"
                [class.tw-border-b]="!last"
                [class.tw-border-solid]="!last"
                [class.tw-border-secondary-300]="!last"
                data-testid="keykeeper-item-version"
              >
                <div class="tw-min-w-0">
                  <div bitTypography="body2">{{ version.revisionDate | date: timeFormat }}</div>
                  @if (savedBy(version); as who) {
                    <div bitTypography="helper" class="tw-text-muted">{{ who }}</div>
                  }
                </div>
                @if (version.view) {
                  <button
                    type="button"
                    bitLink
                    linkType="primary"
                    (click)="open(version)"
                    [attr.aria-label]="
                      ('view' | i18n) + ' ' + (version.revisionDate | date: timeFormat)
                    "
                  >
                    {{ "view" | i18n }}
                  </button>
                }
              </li>
            }
          </ul>
          @if (!showAll() && versions().length > first) {
            <button type="button" bitLink class="tw-mt-2" (click)="showAll.set(true)">
              {{ "keykeeperShowAllVersions" | i18n: versions().length }}
            </button>
          }
          @if (unreadable() > 0) {
            <p bitTypography="helper" class="tw-mb-0 tw-mt-2 tw-text-muted">
              {{ "keykeeperVersionsUnreadable" | i18n: unreadable() }}
            </p>
          }
          @if (canDelete()) {
            <div class="tw-mt-3">
              <button type="button" bitLink linkType="danger" (click)="clear()">
                {{ "keykeeperClearHistory" | i18n }}
              </button>
            </div>
          }
        </bit-card>
      </bit-section>
    }
  `,
})
export class KeykeeperItemVersionsComponent {
  /** The item as it is now. */
  readonly cipher = input.required<CipherView>();
  /** The item dialog's config, whose original item a restore saves over. */
  readonly formConfig = input<CipherFormConfig | undefined>(undefined);
  /** Whether the person can edit the item, and so restore a version. */
  readonly canEdit = input(false);
  /**
   * Whether the person may clear the item's history and delete its versions:
   * view item history and delete in the same shared folder, as the server
   * decides (`historyAccess`).
   */
  readonly canDelete = input(false);
  /** A version was restored: the item as saved. */
  readonly restored = output<CipherView>();

  private readonly historyService = inject(KeykeeperItemHistoryService);
  private readonly accountService = inject(AccountService);
  private readonly dialogService = inject(DialogService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  private readonly toastService = inject(ToastService);
  private readonly cipherFormService = inject(DefaultCipherFormService);

  protected readonly first = FIRST_VERSIONS;
  protected readonly timeFormat = VERSION_TIME_FORMAT;
  protected readonly showAll = signal(false);
  private readonly me = toSignal(this.accountService.activeAccount$.pipe(map((a) => a?.id)));

  /** Loaded again whenever the item is saved, a restore included. */
  private readonly history = resource({
    params: () => {
      const cipher = this.cipher();
      return cipher?.id ? { cipher, revision: cipher.revisionDate?.getTime() } : undefined;
    },
    loader: async ({ params }) => {
      try {
        return await this.load(params.cipher);
      } catch (e) {
        // A server without item history, or none to show: nothing to list.
        this.logService.error(e);
        return { versions: [] as ItemVersion[], unreadable: 0, hidePasswords: false };
      }
    },
  });

  protected readonly versions = computed(() => this.history.value()?.versions ?? []);
  protected readonly unreadable = computed(() => this.history.value()?.unreadable ?? 0);
  protected readonly hidePasswords = computed(() => this.history.value()?.hidePasswords ?? false);
  protected readonly shown = computed(() =>
    this.showAll() ? this.versions() : this.versions().slice(0, FIRST_VERSIONS),
  );

  protected savedBy(version: ItemVersion): string | null {
    return savedByLabel(version.savedBy, this.me(), (key, ...args) =>
      this.i18nService.t(key, ...args.map(String)),
    );
  }

  private async load(current: CipherView) {
    return await this.historyService.load(current);
  }

  protected async open(version: ItemVersion) {
    if (version.view == null) {
      return;
    }
    const view = version.view;
    const current = this.cipher();
    const config = this.formConfig();
    // Never for someone who can't see the item's passwords: restoring would
    // put back secrets they can't see (DESIGN.md, "Item history").
    const canRestore =
      this.canEdit() &&
      maySeeSecrets(current) &&
      !current.isDeleted &&
      config?.originalCipher != null;
    const ref = KeykeeperVersionDialogComponent.open(this.dialogService, {
      version: view,
      current,
      revisionDate: version.revisionDate,
      savedBy: this.savedBy(version),
      restore: canRestore ? () => this.restore(view) : undefined,
      delete: this.canDelete() ? () => this.deleteVersion(version) : undefined,
    });
    const result: VersionDialogResult = await firstValueFrom(ref.closed);
    if (result instanceof CipherView) {
      this.restored.emit(result);
    } else if (result === "deleted") {
      this.history.reload();
    }
  }

  /** Saves the version as a normal edit of the item, as its editor would. */
  private async restore(version: CipherView): Promise<CipherView> {
    return await this.historyService.restore(
      this.cipherFormService,
      version,
      this.cipher(),
      this.formConfig()!,
    );
  }

  private async deleteVersion(version: ItemVersion) {
    await this.historyService.deleteVersion(this.cipher().id, version.id);
  }

  /** Clears the item's history for everyone, once the person confirms. */
  protected async clear() {
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
      await this.historyService.clear(this.cipher().id);
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
    this.history.reload();
  }
}
