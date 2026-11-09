import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getOptionalUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { ButtonModule, CalloutModule } from "@bitwarden/components";

import {
  BrowserAutofillState,
  localStateStore,
  StateStore,
} from "../../autofill/keykeeper/browser-autofill-switches";
import { BrowserApi } from "../../platform/browser/browser-api";

/** What the popup says in this profile, from what the background did. */
export type BrowserAutofillNotice = {
  /** The organizations that turned the browser's card and address autofill off here, not yet told. */
  note: string[];
  /** Whether to offer this account to bring its saved cards and addresses in. */
  offer: boolean;
};

/**
 * The note shows once per organization in a profile where the extension took
 * the browser's switches; the offer shows for each account whose organization
 * asks for it, until the person says Done.
 */
export function noticeFor(
  state: BrowserAutofillState,
  userId: string | null,
): BrowserAutofillNotice {
  const tookThem = state.off && (state.taken.cards || state.taken.addresses);
  const note = tookThem ? state.orgs.filter((o) => !state.seen.includes(o.id)) : [];
  const offer = userId != null && state.offerTo.includes(userId) && !state.offered.includes(userId);
  return { note: note.map((o) => o.name), offer };
}

/** "Acme Dental", "Acme Dental and Lakeside Clinic", "A, B, and C". */
export function namesInWords(names: string[]): string {
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Chrome's own pages for saved cards and addresses. Other browsers' are said in words. */
export const CHROME_SAVED_CARDS = "chrome://settings/payments";
export const CHROME_SAVED_ADDRESSES = "chrome://settings/addresses";

/**
 * Keykeeper: in the popup's vault, what an organization's setting for the
 * browser's own card and address autofill did in this profile, said once,
 * and, where the organization asks for it, one offer to bring the person's
 * saved cards and addresses in. Browsers don't export them, so the offer opens
 * the browser's own list beside the popup's New card and New identity. See
 * DESIGN.md, "Addresses and cards".
 */
@Component({
  selector: "app-keykeeper-browser-autofill-notice",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, CalloutModule],
  template: `
    @if (notice(); as n) {
      @if (n.note.length) {
        <bit-callout type="info" class="tw-mb-3 tw-block" data-testid="browser-autofill-note">
          <p class="tw-mb-2">
            {{ names(n.note) }} turned off {{ browser }}'s own card and address autofill in this
            profile, since your account there is signed in here. Your cards and addresses fill from
            {{ product }} instead.
          </p>
          <button bitButton buttonType="secondary" type="button" (click)="seen()">Got it</button>
        </bit-callout>
      }
      @if (n.offer) {
        <bit-callout
          type="info"
          title="Bring your cards and addresses in"
          class="tw-mb-3 tw-block"
          data-testid="browser-autofill-offer"
        >
          <p class="tw-mb-2">
            Move the cards and addresses {{ browser }} saved into {{ product }}, so they fill from
            here. Browsers don't export them, so add each one: open {{ browser }}'s list, and add it
            here with New card or New identity.
          </p>
          @if (!chromeLists) {
            <p class="tw-mb-2">{{ browser }} keeps them in its settings.</p>
          }
          <div class="tw-flex tw-flex-wrap tw-gap-2">
            @if (chromeLists) {
              <button bitButton buttonType="secondary" type="button" (click)="openList('cards')">
                Open saved cards
              </button>
              <button
                bitButton
                buttonType="secondary"
                type="button"
                (click)="openList('addresses')"
              >
                Open saved addresses
              </button>
            }
            <button bitButton buttonType="primary" type="button" (click)="add(card)">
              New card
            </button>
            <button bitButton buttonType="primary" type="button" (click)="add(identity)">
              New identity
            </button>
            <button bitButton buttonType="secondary" type="button" (click)="done()">Done</button>
          </div>
        </bit-callout>
      }
    }
  `,
})
export class KeykeeperBrowserAutofillNoticeComponent implements OnInit {
  private readonly accountService = inject(AccountService);
  private readonly router = inject(Router);
  private readonly platformUtils = inject(PlatformUtilsService);
  private readonly store: StateStore = localStateStore();

  protected readonly notice = signal<BrowserAutofillNotice | null>(null);
  protected readonly product = inject(I18nService).t("keykeeperProductName");
  protected readonly browser = this.platformUtils.isEdge()
    ? "Edge"
    : this.platformUtils.isFirefox()
      ? "Firefox"
      : "Chrome";
  /** Only Chrome's pages for them are known to open from an extension. */
  protected readonly chromeLists = this.browser === "Chrome";
  protected readonly card = CipherType.Card;
  protected readonly identity = CipherType.Identity;
  protected readonly names = namesInWords;
  private readonly userId = signal<string | null>(null);

  async ngOnInit() {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getOptionalUserId));
    this.userId.set(userId);
    const notice = noticeFor(await this.store.get(), userId);
    this.notice.set(notice.note.length || notice.offer ? notice : null);
  }

  protected async seen() {
    const state = await this.store.get();
    state.seen = [...new Set([...state.seen, ...state.orgs.map((o) => o.id)])];
    await this.store.set(state);
    this.notice.update((n) => (n == null ? n : { ...n, note: [] }));
  }

  /** Ends the offer for this account in this profile. */
  protected async done() {
    await this.offered();
  }

  protected async openList(which: "cards" | "addresses") {
    await BrowserApi.createNewTab(which === "cards" ? CHROME_SAVED_CARDS : CHROME_SAVED_ADDRESSES);
  }

  /** Adding one doesn't end the offer: there may be more to add. */
  protected async add(type: CipherType) {
    await this.router.navigate(["/add-cipher"], { queryParams: { type: type.toString() } });
  }

  private async offered() {
    const userId = this.userId();
    if (userId == null) {
      return;
    }
    const state = await this.store.get();
    state.offered = [...new Set([...state.offered, userId])];
    await this.store.set(state);
    this.notice.update((n) => (n == null ? n : { ...n, offer: false }));
  }
}
