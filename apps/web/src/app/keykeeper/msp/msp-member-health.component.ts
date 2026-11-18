import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from "@angular/core";

import { MspClient, OrganizationUserApiService } from "@bitwarden/admin-console/common";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";

import { SharedModule } from "../../shared";
import { MemberHealthRow, memberHealthRows, memberHealthTotals } from "../health/member-health";

import { MspMemberHealthClient, ownHealthSummary } from "./msp-member-health";

/**
 * Keykeeper: a client's "Members' own passwords" in the MSP console, for
 * MSP staff who manage it: each of its own members' numbers as its owners
 * and admins see them in its Reports, named from its member list. Numbers
 * only, never which items, and never the MSP's own people. With the setting
 * off, it says so and where it's turned on. See DESIGN.md, "Members' own
 * passwords".
 */
@Component({
  selector: "app-keykeeper-msp-member-health",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @let c = client();
    @let v = view();
    <section
      class="tw-mt-4 tw-rounded-lg tw-border tw-border-solid tw-border-secondary-300 tw-p-4"
      aria-label="Members' own passwords"
      data-testid="msp-own-health"
    >
      <h3 bitTypography="h5">Members' own passwords in {{ c.name }}</h3>
      @if (!v.on) {
        <p bitTypography="body2" class="tw-mb-0" data-testid="msp-own-health-off">
          Members' own passwords is off for {{ c.name }}, so nobody's numbers are shown.
          @if (canTurnOn()) {
            <a bitLink [routerLink]="['/organizations', c.id, 'settings', 'joining']"
              >Turn it on in {{ c.name }}'s Joining and security</a
            >
          } @else {
            An MSP admin, or {{ c.name }}'s own owners and admins, can turn it on.
          }
        </p>
      } @else {
        <p bitTypography="body2">
          How many of each member's own logins, in their Personal items, have weak, reused, or
          exposed passwords, as {{ c.name }}'s owners and admins see them in its Reports.
        </p>
        <p bitTypography="helper">
          Each member's apps count their own logins and send only these numbers. Neither you nor the
          server sees which logins, their names, or their passwords. Your MSP's own people aren't
          counted.
        </p>
        @if (failed()) {
          <p bitTypography="body2" class="tw-mb-0" data-testid="msp-own-health-failed">
            Couldn't load {{ c.name }}'s members.
          </p>
        } @else if (rows(); as list) {
          <p bitTypography="body2" data-testid="msp-own-health-summary">{{ summary(list) }}</p>
          @if (list.length > 0) {
            <bit-table>
              <ng-container header>
                <tr>
                  <th bitCell>Member</th>
                  <th bitCell class="tw-text-right">Logins</th>
                  <th bitCell class="tw-text-right">Weak</th>
                  <th bitCell class="tw-text-right">Reused</th>
                  <th bitCell class="tw-text-right">Exposed</th>
                  <th bitCell>Reported</th>
                </tr>
              </ng-container>
              <ng-template body>
                @for (row of list; track row.memberId) {
                  <tr bitRow data-testid="msp-own-health-row" [attr.data-email]="row.email">
                    <td bitCell>
                      {{ row.name }}
                      @if (row.name !== row.email) {
                        <small class="tw-block tw-text-muted">{{ row.email }}</small>
                      }
                    </td>
                    @if (row.reportedAt == null) {
                      <td bitCell colspan="4" class="tw-text-muted">Not reported yet</td>
                      <td bitCell></td>
                    } @else {
                      <td bitCell class="tw-text-right" data-testid="msp-own-health-logins">
                        {{ row.logins }}
                      </td>
                      <td bitCell class="tw-text-right" data-testid="msp-own-health-weak">
                        {{ row.weak }}
                      </td>
                      <td bitCell class="tw-text-right" data-testid="msp-own-health-reused">
                        {{ row.reused }}
                      </td>
                      <td bitCell class="tw-text-right" data-testid="msp-own-health-exposed">
                        @if (row.exposed == null) {
                          <span class="tw-text-muted">Not checked</span>
                        } @else {
                          {{ row.exposed }}
                        }
                      </td>
                      <td bitCell>{{ when(row.reportedAt) }}</td>
                    }
                  </tr>
                }
              </ng-template>
            </bit-table>
            @if (exposedUnchecked(list) > 0) {
              <p bitTypography="helper" class="tw-mb-0 tw-mt-3">
                Exposed says "Not checked" until one of the member's apps checks their passwords
                against known breaches.
              </p>
            }
          }
        } @else {
          <bit-icon name="bwi-spinner" class="bwi-spin tw-text-muted" title="Loading" />
        }
      }
    </section>
  `,
})
export class KeykeeperMspMemberHealthComponent {
  readonly client = input.required<MspClient>();
  readonly view = input.required<MspMemberHealthClient>();
  /** An MSP admin, who can turn the setting on in the client. */
  readonly canTurnOn = input(false);

  private readonly organizationUserApiService = inject(OrganizationUserApiService);
  private readonly logService = inject(LogService);

  /** The members, named; null while their names load. */
  protected readonly rows = signal<MemberHealthRow[] | null>(null);
  protected readonly failed = signal(false);
  protected readonly summary = ownHealthSummary;

  constructor() {
    effect(() => {
      const view = this.view();
      const clientId = this.client().id;
      void this.name(clientId, view);
    });
  }

  /** Names each member from the client's member list, as its Reports do. */
  private async name(clientId: string, view: MspMemberHealthClient) {
    this.rows.set(null);
    this.failed.set(false);
    if (!view.on) {
      return;
    }
    try {
      const members = await this.organizationUserApiService.getAllMiniUserDetails(clientId);
      if (this.view() === view) {
        this.rows.set(memberHealthRows(view.members, members.data));
      }
    } catch (e) {
      this.logService.error(e);
      if (this.view() === view) {
        this.failed.set(true);
      }
    }
  }

  protected exposedUnchecked(rows: MemberHealthRow[]): number {
    return memberHealthTotals(rows).exposedUnchecked;
  }

  protected when(date: string | null): string {
    return date == null
      ? ""
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
  }
}
