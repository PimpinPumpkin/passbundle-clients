import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { CardComponent, SectionHeaderComponent, TypographyModule } from "@bitwarden/components";

import { listFillRules } from "./fill-rules";

/**
 * Keykeeper: the item's fill rules in plain language, in the item view.
 * Nothing shows when it has none. See DESIGN.md, "Choosing what fills where".
 */
@Component({
  selector: "app-keykeeper-fill-rules",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, SectionHeaderComponent, TypographyModule],
  template: `
    @if (rules().length) {
      <section class="tw-mb-5 bit-compact:tw-mb-4" data-testid="keykeeper-fill-rules">
        <bit-section-header>
          <h2 bitTypography="h6">Fill rules</h2>
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
            Made with "Fill this field with" in the browser extension. Edit the item to remove one.
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

  protected readonly rules = computed(() => listFillRules(this.cipher()));
}
