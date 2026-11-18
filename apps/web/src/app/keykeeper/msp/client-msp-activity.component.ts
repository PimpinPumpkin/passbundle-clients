import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";

import { ButtonModule, TypographyModule } from "@bitwarden/components";

import { ClientMspEvent, describeClientEvent } from "./msp-activity";
import { KeykeeperMspApiService } from "./msp-api.service";

const PAGE = 10;

/**
 * Keykeeper: on a client organization's Members page, under its MSP's banner,
 * what the MSP did there, newest first, in plain sentences: its people added,
 * given another role, or removed, members confirmed, the install command
 * replaced and people joining with it, default policies and templates sent.
 * Only for the client's own owners and admins (client-msp-activity.ts); the
 * server sends only entries about this organization (DESIGN.md, "The client
 * sees its MSP's actions").
 */
@Component({
  selector: "app-keykeeper-client-msp-activity",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, DatePipe, TypographyModule],
  template: `
    @if (entries(); as list) {
      <section
        class="tw-mt-3"
        [attr.aria-label]="'What ' + mspName() + ' did here'"
        data-testid="client-msp-activity"
      >
        <h3 bitTypography="h6" class="tw-mb-1">What {{ mspName() }} did here</h3>
        @if (list.length === 0) {
          <p class="tw-mb-0" bitTypography="body2">Nothing yet.</p>
        } @else {
          <ul class="tw-m-0 tw-list-none tw-p-0">
            @for (e of list; track e.id) {
              <li class="tw-py-1" data-testid="client-msp-activity-entry">
                <div bitTypography="body2">{{ line(e) }}</div>
                <div class="tw-text-xs tw-text-muted">{{ e.date | date: "medium" }}</div>
              </li>
            }
          </ul>
          @if (more()) {
            <button
              bitButton
              buttonType="secondary"
              size="small"
              type="button"
              class="tw-mt-1"
              (click)="showOlder()"
            >
              Show older
            </button>
          }
        }
      </section>
    }
  `,
})
export class KeykeeperClientMspActivityComponent {
  readonly organizationId = input.required<string>();
  readonly mspName = input.required<string>();
  /** The page's member list: a change, such as someone removed, reads it again. */
  readonly members = input<unknown>(null);

  /** Null until loaded, and if it can't be: then nothing shows. */
  protected readonly entries = signal<ClientMspEvent[] | null>(null);
  protected readonly more = signal(false);

  constructor(private readonly mspApi: KeykeeperMspApiService) {
    effect(() => {
      const orgId = this.organizationId();
      this.members();
      this.mspApi.getOrganizationMspActivity(orgId, undefined, PAGE).then(
        (answer) => {
          this.entries.set(answer.data);
          this.more.set(answer.data.length === PAGE);
        },
        () => this.entries.set(null),
      );
    });
  }

  protected line(e: ClientMspEvent): string {
    return describeClientEvent(e, this.mspName());
  }

  protected async showOlder() {
    const shown = this.entries() ?? [];
    const oldest = shown.at(-1);
    if (oldest == null) {
      return;
    }
    try {
      const older = await this.mspApi.getOrganizationMspActivity(
        this.organizationId(),
        oldest.date,
        PAGE,
      );
      this.entries.set([...shown, ...older.data]);
      this.more.set(older.data.length === PAGE);
    } catch {
      this.more.set(false);
    }
  }
}
