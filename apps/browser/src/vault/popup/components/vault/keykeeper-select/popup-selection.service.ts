import { computed, inject, Injectable, signal } from "@angular/core";
import { toObservable, toSignal } from "@angular/core/rxjs-interop";
import { combineLatest, firstValueFrom, map, of, switchMap } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { uuidAsString } from "@bitwarden/common/platform/abstractions/sdk/sdk.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CipherId, UserId } from "@bitwarden/common/types/guid";
import { CipherArchiveService } from "@bitwarden/common/vault/abstractions/cipher-archive.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherRepromptType } from "@bitwarden/common/vault/enums/cipher-reprompt-type";
import { CipherAuthorizationService } from "@bitwarden/common/vault/services/cipher-authorization.service";
import { CipherViewLikeUtils } from "@bitwarden/common/vault/utils/cipher-view-like-utils";
import { DialogService, ToastService } from "@bitwarden/components";
import {
  BulkDeleteService,
  BulkPlan,
  MAX_SELECTION,
  PasswordRepromptService,
  splitByAllowed,
  stillListed,
} from "@bitwarden/vault";

import { PopupCipherViewLike } from "../../../views/popup-cipher.view";

import { KeykeeperMoveToFolderDialogComponent } from "./move-to-folder-dialog.component";
import { allSelected, clickAll, clickRow } from "./popup-selection";

/** An item's id as the selection keeps it. */
export const selectionId = (row: PopupCipherViewLike) => uuidAsString(row.id as CipherId);

/**
 * Whether a row can be selected. An item that couldn't be decrypted can't, as
 * in the web vault: its own menu offers nothing these actions do.
 */
export const selectable = (row: PopupCipherViewLike) => !CipherViewLikeUtils.decryptionFailure(row);

/**
 * Keykeeper: Select mode in the popup's item lists (DESIGN.md, "Selecting
 * several items"): which items are selected, and Move to folder, Move to
 * trash, and Archive for them. Nothing here decides what a person may do or
 * encrypts anything: it asks the rules a single item's own menu asks
 * (CipherAuthorizationService, CipherArchiveService), and calls the services
 * the web vault's bar calls for many items at once (CipherService's move,
 * BulkDeleteService, CipherArchiveService), with the ids of the items that
 * passed. Provided by the vault page, so it ends with the page.
 */
@Injectable()
export class KeykeeperPopupSelectionService {
  private readonly accountService = inject(AccountService);
  private readonly cipherService = inject(CipherService);
  private readonly cipherArchiveService = inject(CipherArchiveService);
  private readonly cipherAuthorizationService = inject(CipherAuthorizationService);
  private readonly bulkDeleteService = inject(BulkDeleteService);
  private readonly passwordRepromptService = inject(PasswordRepromptService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  private readonly syncService = inject(SyncService);

  private readonly _active = signal(false);
  /** Whether the list is in Select mode. */
  readonly active = this._active.asReadonly();

  /** The list as it shows now: All items, a kind, a folder, or search results. */
  private readonly listed = signal<readonly PopupCipherViewLike[]>([]);

  /** The ids of the selected items, in the order they were selected. */
  private readonly picked = signal<readonly string[]>([]);

  /** The row clicked last, where a Shift+click's range starts. */
  private anchor: string | undefined;

  /** The rows that can be selected, as the list shows them. */
  private readonly order = computed(() => this.listed().filter(selectable).map(selectionId));

  private readonly pickedSet = computed(() => new Set(this.picked()));

  /** The selected items, in the order they were selected. */
  readonly selected = computed(() => {
    const rows = new Map(this.listed().map((row) => [selectionId(row), row]));
    return this.picked().flatMap((id): PopupCipherViewLike[] => {
      const row = rows.get(id);
      return row == null ? [] : [row];
    });
  });

  readonly count = computed(() => this.selected().length);

  /** "Select all" is checked: everything shown is selected. */
  readonly allSelected = computed(() => allSelected(this.picked(), this.order()));

  /** "Select all" is partly checked: some of what is shown is selected. */
  readonly someSelected = computed(() => this.count() > 0 && !this.allSelected());

  private readonly _busy = signal(false);
  /** While an action runs, the bar holds its buttons. */
  readonly busy = this._busy.asReadonly();

  private readonly userCanArchive = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => this.cipherArchiveService.userCanArchive$(userId)),
    ),
    { initialValue: false },
  );

  /** Move to folder: a folder is the person's own place for an item, so any item they see. */
  readonly canMove = computed(() => this.count() > 0);

  /** Archive is offered where the single item's menu offers it: to everyone who can archive. */
  readonly archiveOffered = computed(() => this.userCanArchive());

  /** Archive: for every item the list shows, as the single item's menu has it. */
  readonly canArchive = computed(() => this.count() > 0 && this.archiveOffered());

  /** Move to trash: when at least one selected item may be deleted, by the single item's rule. */
  readonly canTrash = toSignal(
    toObservable(this.selected).pipe(
      switchMap((items) =>
        items.length === 0
          ? of(false)
          : combineLatest(
              items.map((c) => this.cipherAuthorizationService.canDeleteCipher$(c)),
            ).pipe(map((answers) => answers.some((a) => a))),
      ),
    ),
    { initialValue: false },
  );

  /** Turns Select mode on, with nothing selected. */
  start(): void {
    this.picked.set([]);
    this.anchor = undefined;
    this._active.set(true);
  }

  /** Leaves Select mode and lets go of the selection. */
  stop(): void {
    this._active.set(false);
    this.picked.set([]);
    this.anchor = undefined;
  }

  /**
   * The list changed (a sync, a search, another kind or folder). Rows still in
   * it stay selected; the rest are let go of, so nothing is done to an item
   * nobody can see.
   */
  setListed(rows: readonly PopupCipherViewLike[]): void {
    this.listed.set(rows);
    const order = this.order();
    this.picked.update((ids) => stillListed(ids, order, (id) => id));
    if (this.anchor != null && !order.includes(this.anchor)) {
      this.anchor = undefined;
    }
  }

  isSelected(row: PopupCipherViewLike): boolean {
    return this.pickedSet().has(selectionId(row));
  }

  /** A row's checkbox was clicked, with Shift held or not. */
  click(row: PopupCipherViewLike, shift: boolean): void {
    if (!selectable(row)) {
      return;
    }
    const id = selectionId(row);
    const step = clickRow(this.picked(), this.order(), id, this.anchor, shift);
    this.anchor = id;
    this.picked.set(step.ids);
    if (step.limited) {
      this.sayLimit();
    }
  }

  /** "Select all" was clicked. */
  clickAll(): void {
    const step = clickAll(this.picked(), this.order());
    this.anchor = undefined;
    this.picked.set(step.ids);
    if (step.limited) {
      this.sayLimit();
    }
  }

  /** Moves the selected items to one of the person's folders, or out of them. */
  async moveToFolder(): Promise<void> {
    const items = this.selected();
    if (!this.canMove() || this._busy() || !(await this.reprompt(items))) {
      return;
    }

    const choice = await firstValueFrom(
      KeykeeperMoveToFolderDialogComponent.open(this.dialogService, { count: items.length }).closed,
    );
    // Closed without picking (Cancel, Close, Escape): nothing moves. Only a choice with a
    // folder (or null, for No folder) moves anything.
    if (choice == null || typeof choice !== "object" || choice.folderId === undefined) {
      return;
    }

    await this.run(async (userId) => {
      await this.cipherService.moveManyWithServer(
        items.map(selectionId),
        choice.folderId as string,
        userId,
      );
      this.toast(
        items.length === 1
          ? this.i18nService.t("keykeeperSelectMovedOne")
          : this.i18nService.t("keykeeperSelectMoved", items.length),
      );
    });
  }

  /** Archives the selected items, after the single item's own confirmation. */
  async archive(): Promise<void> {
    const items = this.selected();
    if (!this.canArchive() || this._busy() || !(await this.reprompt(items))) {
      return;
    }

    const one = items.length === 1;
    const confirmed = await this.dialogService.openSimpleDialog({
      title: one
        ? { key: "archiveItemTitle" }
        : { key: "archiveItemsPlural", placeholders: [items.length] },
      content: { key: one ? "archiveItemDialogContent" : "archiveItemsPluralDescription" },
      acceptButtonText: { key: "archiveVerb" },
      type: "info",
    });
    if (!confirmed) {
      return;
    }

    await this.run(async (userId) => {
      await this.cipherArchiveService.archiveWithServer(
        items.map((c) => selectionId(c) as CipherId),
        userId,
      );
      this.toast(
        one
          ? this.i18nService.t("itemArchiveToast")
          : this.i18nService.t("keykeeperSelectArchived", items.length),
      );
    });
  }

  /**
   * Sends the selected items to the trash. The ones the person may not delete
   * are left out, and the confirmation says how many and why; a message after
   * says how many were.
   */
  async moveToTrash(): Promise<void> {
    const items = this.selected();
    if (items.length === 0 || this._busy()) {
      return;
    }

    const plan = await this.trashPlan(items);
    if (plan.allowed.length === 0) {
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("keykeeperBulkNothingAllowed"),
      });
      return;
    }
    if (!(await this.reprompt(plan.allowed))) {
      return;
    }

    const one = plan.allowed.length === 1;
    const confirmed = await this.dialogService.openSimpleDialog({
      title: one
        ? this.i18nService.t("keykeeperSelectTrashTitleOne")
        : this.i18nService.t("keykeeperSelectTrashTitle", plan.allowed.length),
      content: [
        this.skipNotice(plan),
        this.i18nService.t(one ? "keykeeperSelectTrashBodyOne" : "keykeeperSelectTrashBody"),
      ]
        .filter((line) => line != null)
        .join(" "),
      acceptButtonText: this.i18nService.t("keykeeperSelectMoveToTrash"),
      type: "warning",
    });
    if (!confirmed) {
      return;
    }

    await this.run(async () => {
      await this.bulkDeleteService.deleteCiphers({
        cipherIds: plan.allowed.map(selectionId),
        unassignedCiphers: [],
        permanent: false,
      });
      this.toast(
        one
          ? this.i18nService.t("deletedItem")
          : this.i18nService.t("keykeeperSelectTrashed", plan.allowed.length),
      );
      this.reportSkipped(plan.skipped.length);
    });
  }

  /**
   * Splits the items by the single item's own rule for deleting
   * (canDeleteCipher$): what Move to trash does, and what it leaves alone.
   */
  async trashPlan(items: readonly PopupCipherViewLike[]): Promise<BulkPlan<PopupCipherViewLike>> {
    const answers = await firstValueFrom(
      combineLatest(items.map((c) => this.cipherAuthorizationService.canDeleteCipher$(c))),
    );
    return splitByAllowed(items, answers);
  }

  /**
   * Runs an action's requests. Done, it leaves Select mode. When the server
   * refuses partway, it says some items may not have changed and reads the
   * vault again, so the list shows what did.
   */
  private async run(act: (userId: UserId) => Promise<void>): Promise<void> {
    this._busy.set(true);
    try {
      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      await act(userId);
      this.stop();
    } catch (e) {
      this.logService.error("Keykeeper: an action on several items failed", e);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("keykeeperBulkPartlyFailed"),
      });
      try {
        await this.syncService.fullSync(true);
      } catch (syncError) {
        this.logService.error("Keykeeper: reading the vault again failed", syncError);
      }
      this.stop();
    } finally {
      this._busy.set(false);
    }
  }

  /** Asks for the master password once when an item the action touches asks for it. */
  private async reprompt(items: readonly PopupCipherViewLike[]): Promise<boolean> {
    if (!items.some((c) => c.reprompt !== CipherRepromptType.None)) {
      return true;
    }
    return await this.passwordRepromptService.showPasswordPrompt();
  }

  /** Before Move to trash: how many it will leave out, and why. Undefined when none. */
  private skipNotice(plan: BulkPlan<unknown>): string | undefined {
    const skipped = plan.skipped.length;
    if (skipped === 0) {
      return undefined;
    }
    const total = skipped + plan.allowed.length;
    return skipped === 1
      ? this.i18nService.t("keykeeperBulkSkipDeleteOne", total)
      : this.i18nService.t("keykeeperBulkSkipDelete", skipped, total);
  }

  /** After Move to trash: how many it left out. */
  private reportSkipped(skipped: number): void {
    if (skipped === 0) {
      return;
    }
    this.toastService.showToast({
      variant: "info",
      message:
        skipped === 1
          ? this.i18nService.t("keykeeperBulkSkippedOne")
          : this.i18nService.t("keykeeperBulkSkipped", skipped),
    });
  }

  private toast(message: string): void {
    this.toastService.showToast({ variant: "success", message });
  }

  private sayLimit(): void {
    this.toastService.showToast({
      variant: "info",
      message: this.i18nService.t("keykeeperSelectLimit", MAX_SELECTION),
    });
  }
}
