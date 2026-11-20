import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  englishFillRuleWords,
  FillRule,
  fillRuleWords,
  removeFillRule,
} from "@bitwarden/common/vault/keykeeper/fill-rules";
import {
  CardComponent,
  IconButtonModule,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";

import { CipherFormContainer } from "../cipher-form/cipher-form-container";

import { ListedFillRule, listFillRules } from "./fill-rules";

/**
 * Keykeeper: the item's fill rules in the item editor, in plain language (in
 * the person's language), each with a way to remove it. Rules are made with the extension's fill picker;
 * removing one here takes effect when the item is saved. Nothing shows when
 * the item has none. See DESIGN.md, "Choosing what fills where".
 */
@Component({
  selector: "vault-keykeeper-fill-rules-field",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, IconButtonModule, SectionHeaderComponent, TypographyModule],
  template: `
    @if (rules().length) {
      <section class="tw-mb-5 bit-compact:tw-mb-4" data-testid="keykeeper-fill-rules-editor">
        <bit-section-header>
          <h2 bitTypography="h6">{{ words("keykeeperFillRules") }}</h2>
        </bit-section-header>
        <bit-card>
          <ul class="tw-m-0 tw-list-none tw-p-0">
            @for (entry of rules(); track $index) {
              <li class="tw-flex tw-items-center tw-gap-2 tw-py-1">
                <span bitTypography="body2" class="tw-grow">
                  <strong>{{ entry.site }}</strong
                  >: {{ entry.text }}
                </span>
                @if (canEdit) {
                  <button
                    type="button"
                    bitIconButton="bwi-minus-circle"
                    buttonType="dangerGhost"
                    [label]="words('keykeeperRemoveFillRule', entry.site, entry.text)"
                    (click)="remove(entry.rule)"
                    data-testid="remove-fill-rule"
                  ></button>
                }
              </li>
            }
          </ul>
          <p bitTypography="helper" class="tw-mb-0 tw-mt-2">
            {{ words("keykeeperFillRulesMadeWith") }}
          </p>
        </bit-card>
      </section>
    }
  `,
})
export class KeykeeperFillRulesFieldComponent implements OnInit {
  protected readonly rules = signal<ListedFillRule[]>([]);

  /** The person's language; English where a page has no translations (or none yet). */
  protected readonly words = (() => {
    const i18n = inject(I18nService, { optional: true });
    return i18n ? fillRuleWords(i18n) : englishFillRuleWords;
  })();

  constructor(private readonly cipherFormContainer: CipherFormContainer) {}

  /** Someone who can only change folders and favorites (partial edit) sees rules but can't remove them. */
  protected get canEdit(): boolean {
    return this.cipherFormContainer.config.mode !== "partial-edit";
  }

  ngOnInit() {
    this.rules.set(listFillRules(this.cipherFormContainer.getInitialCipherView(), this.words));
  }

  protected remove(rule: FillRule) {
    this.cipherFormContainer.patchCipher((cipher) => removeFillRule(cipher, rule));
    this.rules.update((rules) => rules.filter((entry) => entry.rule !== rule));
  }
}
