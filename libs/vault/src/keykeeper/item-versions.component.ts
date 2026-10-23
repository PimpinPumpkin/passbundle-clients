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

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherData } from "@bitwarden/common/vault/models/data/cipher.data";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherResponse } from "@bitwarden/common/vault/models/response/cipher.response";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  CardComponent,
  DialogService,
  LinkModule,
  SectionComponent,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { CipherFormConfig } from "../cipher-form/abstractions/cipher-form-config.service";
import { DefaultCipherFormService } from "../cipher-form/services/default-cipher-form.service";

import {
  distinctVersions,
  historyPath,
  ItemHistoryResponse,
  restoredView,
  savedByLabel,
  VersionEditor,
} from "./item-versions";
import { KeykeeperVersionDialogComponent } from "./version-dialog.component";

/** A version decrypted, with who saved it as the caller may see. */
export type ItemVersion = {
  id: string;
  revisionDate: Date;
  savedBy: VersionEditor | null;
  view: CipherView;
};

/** How many versions show before "Show all". */
const FIRST_VERSIONS = 5;

/**
 * Keykeeper: the item's earlier versions in its view, newest first, each with
 * when it was saved and by whom. "View" shows a version next to the item now,
 * with what changed marked, and restores it (DESIGN.md, "Item history").
 * Nothing shows until the item has an earlier version.
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
  providers: [DefaultCipherFormService],
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
                  <div bitTypography="body2">{{ version.revisionDate | date: "medium" }}</div>
                  @if (savedBy(version); as who) {
                    <div bitTypography="helper" class="tw-text-muted">{{ who }}</div>
                  }
                </div>
                <button
                  type="button"
                  bitLink
                  linkType="primary"
                  (click)="open(version)"
                  [attr.aria-label]="
                    ('view' | i18n) + ' ' + (version.revisionDate | date: 'medium')
                  "
                >
                  {{ "view" | i18n }}
                </button>
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
  /** A version was restored: the item as saved. */
  readonly restored = output<CipherView>();

  private readonly apiService = inject(ApiService);
  private readonly cipherService = inject(CipherService);
  private readonly accountService = inject(AccountService);
  private readonly dialogService = inject(DialogService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  private readonly cipherFormService = inject(DefaultCipherFormService);

  protected readonly first = FIRST_VERSIONS;
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
        return { versions: [] as ItemVersion[], unreadable: 0 };
      }
    },
  });

  protected readonly versions = computed(() => this.history.value()?.versions ?? []);
  protected readonly unreadable = computed(() => this.history.value()?.unreadable ?? 0);
  protected readonly shown = computed(() =>
    this.showAll() ? this.versions() : this.versions().slice(0, FIRST_VERSIONS),
  );

  protected savedBy(version: ItemVersion): string | null {
    return savedByLabel(version.savedBy, this.me(), (key, ...args) =>
      this.i18nService.t(key, ...args.map(String)),
    );
  }

  private async load(current: CipherView) {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const response: ItemHistoryResponse = await this.apiService.send(
      "GET",
      historyPath(current.id),
      null,
      true,
      true,
    );
    const decrypted: ItemVersion[] = [];
    let unreadable = 0;
    for (const version of response?.data ?? []) {
      // Decrypted as the vault decrypts any item from the server.
      const cipher = new Cipher(new CipherData(new CipherResponse(version.cipher)));
      const view = await this.cipherService
        .decrypt(cipher, userId)
        .catch((): CipherView | null => null);
      if (view == null || view.decryptionFailure) {
        unreadable++;
        continue;
      }
      decrypted.push({
        id: version.id,
        revisionDate: new Date(version.revisionDate),
        savedBy: version.savedBy,
        view,
      });
    }
    return { versions: distinctVersions(decrypted, current), unreadable };
  }

  protected async open(version: ItemVersion) {
    const current = this.cipher();
    const config = this.formConfig();
    const canRestore = this.canEdit() && !current.isDeleted && config?.originalCipher != null;
    const ref = KeykeeperVersionDialogComponent.open(this.dialogService, {
      version: version.view,
      current,
      revisionDate: version.revisionDate,
      savedBy: this.savedBy(version),
      restore: canRestore ? () => this.restore(version.view) : undefined,
    });
    const saved = await firstValueFrom(ref.closed);
    if (saved instanceof CipherView) {
      this.restored.emit(saved);
    }
  }

  /** Saves the version as a normal edit of the item, as its editor would. */
  private async restore(version: CipherView): Promise<CipherView> {
    const config = this.formConfig()!;
    return await this.cipherFormService.saveCipher(restoredView(version, this.cipher()), config);
  }
}
