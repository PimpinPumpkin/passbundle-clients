import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { BadgeComponent } from "@bitwarden/components";

import { templateDefinition, templateOf } from "./templates";

/**
 * Keykeeper: in the item view, which template an item came from, or that the
 * item is itself a custom template. A copy an MSP keeps up to date says so,
 * but never who it's from: the item's own contents can't be trusted to say
 * (DESIGN.md, "MSP templates").
 */
@Component({
  selector: "app-keykeeper-template-label",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BadgeComponent],
  template: `
    @if (definition(); as d) {
      <p class="tw-mb-4" data-testid="keykeeper-template-definition">
        <span bitBadge variant="subtle"
          ><i class="bwi bwi-file-text tw-mr-1" aria-hidden="true"></i>Template</span
        >
        New {{ d.base === "login" ? "logins" : "notes" }} from this template start with its custom
        fields.
        @if (d.from) {
          It's a copy of a template kept up to date elsewhere, so changes made here may be replaced.
        }
      </p>
    }
    @if (template(); as t) {
      <p class="tw-mb-4" data-testid="keykeeper-template">
        <span bitBadge variant="subtle"
          ><i class="bwi {{ t.icon }} tw-mr-1" aria-hidden="true"></i>{{ t.name }}</span
        >
      </p>
    }
  `,
})
export class KeykeeperTemplateLabelComponent {
  readonly cipher = input<{
    fields?: { name?: string | null; value?: string | null }[] | null;
  } | null>(null);

  protected readonly template = computed(() => templateOf(this.cipher()));
  protected readonly definition = computed(() => templateDefinition(this.cipher()));
}
