import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { firstValueFrom, switchMap } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { StateProvider } from "@bitwarden/common/platform/state";
import { UserId } from "@bitwarden/common/types/guid";
import {
  describeFillRule,
  FillRule,
  fillRuleWords,
} from "@bitwarden/common/vault/keykeeper/fill-rules";
import {
  CardComponent,
  IconButtonModule,
  SectionComponent,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService } from "@bitwarden/legacy-crypto";

import { KeykeeperSiteNeverFill, MAX_LIST_TEXT, SITE_NEVER_FILL } from "../site-never-fill";

/** Shown as nearly full once the list can't take another field of a usual size. */
const NEARLY_FULL = MAX_LIST_TEXT - 300;

/** The section's own words in English, for a build without Keykeeper's strings. */
const ENGLISH: Record<string, string> = {
  keykeeperNeverFilledFields: "Fields never filled",
  keykeeperNeverFilledFieldsHint:
    'Fields you chose "Never fill this field on this site" for. They stay empty for every item on that site, in every browser you sign in to.',
  keykeeperNeverFilledFieldsNone:
    "None yet. To add one, right-click a field, then Fill this field with.",
  keykeeperNeverFilledFieldsFull:
    "The list is nearly full. Remove one to make room; until then, a new one is kept on its item only.",
};

type Listed = { rule: FillRule; site: string; text: string };

/**
 * Keykeeper: the fields the person said never to fill on a site ("Never fill
 * this field on this site" in the fill picker), in the extension's Autofill
 * settings, each with Remove. They follow the account to each browser it's
 * signed in to (site-never-fill.ts). See DESIGN.md, "Choosing what fills
 * where".
 */
@Component({
  selector: "app-keykeeper-site-never-fill-settings",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    IconButtonModule,
    SectionComponent,
    SectionHeaderComponent,
    TypographyModule,
  ],
  template: `
    <bit-section data-testid="site-never-fill-settings">
      <bit-section-header>
        <h2 bitTypography="h6">{{ words("keykeeperNeverFilledFields") }}</h2>
      </bit-section-header>
      <bit-card>
        <p bitTypography="helper" class="tw-mt-0">{{ words("keykeeperNeverFilledFieldsHint") }}</p>
        @if (rules().length) {
          <ul class="tw-m-0 tw-list-none tw-p-0">
            @for (entry of rules(); track $index) {
              <li class="tw-flex tw-items-center tw-gap-2 tw-py-1" data-testid="site-never-fill">
                <span bitTypography="body2" class="tw-grow tw-break-all">
                  <strong>{{ entry.site }}</strong
                  >: {{ entry.text }}
                </span>
                <button
                  type="button"
                  bitIconButton="bwi-minus-circle"
                  buttonType="dangerGhost"
                  [label]="words('keykeeperRemoveFillRule', entry.site, entry.text)"
                  (click)="remove(entry.rule)"
                ></button>
              </li>
            }
          </ul>
          @if (nearlyFull()) {
            <p bitTypography="helper" class="tw-mb-0 tw-mt-2">
              {{ words("keykeeperNeverFilledFieldsFull") }}
            </p>
          }
        } @else {
          <p bitTypography="body2" class="tw-mb-0">{{ words("keykeeperNeverFilledFieldsNone") }}</p>
        }
      </bit-card>
    </bit-section>
  `,
})
export class KeykeeperSiteNeverFillSettingsComponent implements OnInit {
  protected readonly rules = signal<Listed[]>([]);
  protected readonly nearlyFull = signal(false);
  private readonly i18nService = inject(I18nService);
  private readonly ruleWords = fillRuleWords(this.i18nService);
  protected readonly words = (key: string, ...values: string[]) =>
    this.i18nService.t(key, ...(values as [string?, string?, string?])) ||
    ENGLISH[key] ||
    this.ruleWords(key, ...values);

  private readonly accountService = inject(AccountService);
  private readonly stateProvider = inject(StateProvider);
  private readonly list = new KeykeeperSiteNeverFill(
    this.stateProvider,
    inject(KeyService),
    inject(EncryptService),
    this.accountService,
  );
  private readonly destroyRef = inject(DestroyRef);
  private readonly userId = signal<UserId | null>(null);

  async ngOnInit() {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    this.userId.set(userId);
    // The list as it is now, and again whenever it changes (another browser's, after a sync).
    this.stateProvider
      .getUser(userId, SITE_NEVER_FILL)
      .state$.pipe(
        switchMap(() => this.list.list(userId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rules) => this.show(rules));
  }

  private show(rules: FillRule[]) {
    this.rules.set(rules.map((rule) => ({ rule, ...describeFillRule(rule, this.ruleWords) })));
    this.nearlyFull.set(JSON.stringify(rules).length > NEARLY_FULL);
  }

  protected async remove(rule: FillRule) {
    const userId = this.userId();
    if (userId == null) {
      return;
    }
    await this.list.remove(rule, userId);
    this.show(await this.list.list(userId));
  }
}
