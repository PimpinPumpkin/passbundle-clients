import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { englishFillRuleWords, fillRuleWords } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { CardComponent, SectionHeaderComponent, TypographyModule } from "@bitwarden/components";

import { listFillRules } from "./fill-rules";

/**
 * Keykeeper: the item's fill rules in plain language, in the person's
 * language, in the item view. Nothing shows when it has none. See DESIGN.md,
 * "Choosing what fills where".
 */
@Component({
  selector: "app-keykeeper-fill-rules",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, SectionHeaderComponent, TypographyModule],
  template: `
    @if (rules().length) {
      <section class="tw-mb-5 bit-compact:tw-mb-4" data-testid="keykeeper-fill-rules">
        <bit-section-header>
          <h2 bitTypography="h6">{{ words("keykeeperFillRules") }}</h2>
        </bit-section-header>
        <bit-card>
          <ul class="tw-m-0 tw-list-none tw-p-0">
            @for (entry of rules(); track $index) {
              <li bitTypography="body2" class="tw-py-1">
                <strong>{{ entry.site }}</strong
                >: {{ entry.text }}
              </li>
            }
          </ul>
          <p bitTypography="helper" class="tw-mb-0 tw-mt-2">
            {{ words("keykeeperFillRulesMadeWith") }} {{ words("keykeeperFillRulesEditToRemove") }}
          </p>
        </bit-card>
      </section>
    }
  `,
})
export class KeykeeperFillRulesViewComponent {
  readonly cipher = input<{
    fields?: { name?: string | null; value?: string | null }[] | null;
  } | null>(null);

  /** The person's language; English where a page has no translations (or none yet). */
  protected readonly words = (() => {
    const i18n = inject(I18nService, { optional: true });
    return i18n ? fillRuleWords(i18n) : englishFillRuleWords;
  })();

  protected readonly rules = computed(() => listFillRules(this.cipher(), this.words));
}
