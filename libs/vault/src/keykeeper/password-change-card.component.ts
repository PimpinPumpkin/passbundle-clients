import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import {
  passwordBeforeChange,
  unfinishedPasswordChange,
  withChangeConfirmed,
  withOldPasswordBack,
} from "@bitwarden/common/vault/keykeeper/password-change";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import {
  AsyncActionsModule,
  ButtonModule,
  CalloutModule,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { KeykeeperPasswordChangeService } from "./password-change.service";

/**
 * Keykeeper: an item's unfinished password change (DESIGN.md, "Assisted
 * password change", "The item's state"), above the item in the extension and
 * the web vault: "Did the new password work?", or "The site didn't take the
 * new password", with "Put the old password back" (the password from before
 * the change, out of password history, which keeps the new one in turn) and
 * "It worked". Both are normal edits, sent with the revision they replace.
 * Only for people who can edit the item and see its passwords. While the
 * change still runs in this browser, it says so instead, without buttons.
 */
@Component({
  selector: "vault-keykeeper-password-change-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsyncActionsModule, ButtonModule, CalloutModule, I18nPipe, TypographyModule],
  template: `
    @if (shown(); as s) {
      <bit-callout
        [type]="s.refused ? 'danger' : 'warning'"
        [title]="s.title"
        data-testid="keykeeper-password-change-card"
      >
        <p class="tw-mb-0">{{ s.text }}</p>
        @if (!s.running) {
          <div class="tw-mt-3 tw-flex tw-flex-wrap tw-gap-2">
            @if (s.canPutBack) {
              <button
                type="button"
                bitButton
                [buttonType]="s.refused ? 'primary' : 'secondary'"
                size="small"
                [bitAction]="putBack"
                data-testid="keykeeper-password-change-put-back"
              >
                {{ "keykeeperPasswordChangePutBack" | i18n }}
              </button>
            }
            <button
              type="button"
              bitButton
              [buttonType]="s.refused ? 'secondary' : 'primary'"
              size="small"
              [bitAction]="itWorked"
              data-testid="keykeeper-password-change-it-worked"
            >
              {{ "keykeeperPasswordChangeItWorked" | i18n }}
            </button>
          </div>
        }
      </bit-callout>
    }
  `,
})
export class KeykeeperPasswordChangeCardComponent {
  private readonly accountService = inject(AccountService);
  private readonly cipherService = inject(CipherService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  private readonly toastService = inject(ToastService);
  private readonly changeService = inject(KeykeeperPasswordChangeService, { optional: true });

  readonly cipher = input<CipherView | null | undefined>();
  /** The item as saved, after "Put the old password back" or "It worked". */
  readonly saved = output<CipherView>();

  /** A change for this item still running in this browser, as the extension's background says. */
  private readonly running = signal<{ running: boolean; text: string } | null>(null);

  constructor() {
    effect(() => {
      const id = this.cipher()?.id;
      this.running.set(null);
      if (
        id == null ||
        this.changeService == null ||
        unfinishedPasswordChange(this.cipher()) == null
      ) {
        return;
      }
      void this.changeService.status(id).then(
        (status) => this.cipher()?.id === id && this.running.set(status),
        () => {},
      );
    });
  }

  protected readonly shown = computed(() => {
    const cipher = this.cipher();
    const marker = unfinishedPasswordChange(cipher);
    if (cipher == null || marker == null || cipher.edit !== true || cipher.viewPassword !== true) {
      return null;
    }
    const running = this.running();
    if (running?.running) {
      return {
        running: true,
        refused: false,
        canPutBack: false,
        title: this.i18nService.t("keykeeperPasswordChangeRunningTitle"),
        text: running.text,
      };
    }
    const when = new Date(marker.at).toLocaleString(this.i18nService.translationLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const refused = marker.state === "refused";
    return {
      running: false,
      refused,
      canPutBack: passwordBeforeChange(cipher) != null,
      title: this.i18nService.t(
        refused ? "keykeeperPasswordChangeRefusedTitle" : "keykeeperPasswordChangeUnsureTitle",
      ),
      text: this.i18nService.t(
        refused ? "keykeeperPasswordChangeRefusedText" : "keykeeperPasswordChangeUnsureText",
        when,
        marker.site,
      ),
    };
  });

  protected readonly putBack = async () => {
    const cipher = this.cipher();
    const draft = cipher == null ? null : withOldPasswordBack(cipher);
    if (cipher == null || draft == null) {
      return;
    }
    await this.save(cipher, draft, "keykeeperPasswordChangePutBackDone");
  };

  protected readonly itWorked = async () => {
    const cipher = this.cipher();
    if (cipher == null || unfinishedPasswordChange(cipher) == null) {
      return;
    }
    await this.save(cipher, withChangeConfirmed(cipher), "keykeeperPasswordChangeItWorkedDone");
  };

  private async save(current: CipherView, draft: CipherView, doneKey: string) {
    try {
      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      const saved = await this.cipherService.updateWithServer(draft, userId, current);
      this.toastService.showToast({ variant: "success", message: this.i18nService.t(doneKey) });
      this.saved.emit(saved);
    } catch (e) {
      this.logService.error(e);
      this.toastService.showToast({
        variant: "error",
        message: this.i18nService.t("keykeeperPasswordChangeSaveFailed"),
      });
    }
  }
}
