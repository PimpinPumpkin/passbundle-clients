import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { OrganizationUserApiService } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

import {
  MemberHealthReport,
  memberHealthRows,
  MemberHealthRow,
  memberHealthTotals,
} from "./member-health";

/**
 * Keykeeper: "Members' own passwords" in an organization's Reports, for its
 * owners and admins: how many of each confirmed member's own logins (their
 * Personal items) have weak, reused, or exposed passwords, as their apps
 * reported them. Numbers only: neither the admin nor the server sees which
 * items. While the organization has it off, the page says so and where to
 * turn it on, and lists nobody. See DESIGN.md, "Members' own passwords".
 */
@Component({
  selector: "app-keykeeper-member-health-report",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule],
  template: `
    <app-header></app-header>
    <bit-container>
      <p>{{ "keykeeperMemberHealthReportDesc" | i18n }}</p>
      <p class="tw-text-sm tw-text-muted">{{ "keykeeperMemberHealthPrivacy" | i18n }}</p>
      @if (loading()) {
        <bit-icon
          name="bwi-spinner"
          class="bwi-spin tw-text-muted"
          [title]="'loading' | i18n"
        ></bit-icon>
        <span class="tw-sr-only">{{ "loading" | i18n }}</span>
      } @else if (failed()) {
        <bit-callout type="danger" [title]="'errorOccurred' | i18n">
          {{ "keykeeperMemberHealthCouldntLoad" | i18n }}
        </bit-callout>
      } @else if (off()) {
        <bit-callout type="info" [title]="null" data-testid="member-health-off">
          {{ "keykeeperMemberHealthOff" | i18n }}
          <a bitLink [routerLink]="settingsLink()">{{ "keykeeperMemberHealthTurnOn" | i18n }}</a>
        </bit-callout>
      } @else {
        @let total = totals();
        <p data-testid="member-health-summary">
          {{ summary() }}
        </p>
        <bit-table>
          <ng-container header>
            <tr>
              <th bitCell>{{ "member" | i18n }}</th>
              <th bitCell class="tw-text-right">{{ "keykeeperMemberHealthLogins" | i18n }}</th>
              <th bitCell class="tw-text-right">{{ "keykeeperMemberHealthWeak" | i18n }}</th>
              <th bitCell class="tw-text-right">{{ "keykeeperMemberHealthReused" | i18n }}</th>
              <th bitCell class="tw-text-right">{{ "keykeeperMemberHealthExposed" | i18n }}</th>
              <th bitCell>{{ "keykeeperMemberHealthReported" | i18n }}</th>
            </tr>
          </ng-container>
          <ng-template body>
            @for (row of rows(); track row.memberId) {
              <tr bitRow data-testid="member-health-row" [attr.data-email]="row.email">
                <td bitCell>
                  {{ row.name }}
                  @if (row.name !== row.email) {
                    <small class="tw-block tw-text-muted">{{ row.email }}</small>
                  }
                </td>
                @if (row.reportedAt == null) {
                  <td bitCell colspan="4" class="tw-text-muted" data-testid="member-health-none">
                    {{ "keykeeperMemberHealthNotReported" | i18n }}
                  </td>
                  <td bitCell></td>
                } @else {
                  <td bitCell class="tw-text-right" data-testid="member-health-logins">
                    {{ row.logins }}
                  </td>
                  <td bitCell class="tw-text-right" data-testid="member-health-weak">
                    {{ row.weak }}
                  </td>
                  <td bitCell class="tw-text-right" data-testid="member-health-reused">
                    {{ row.reused }}
                  </td>
                  <td bitCell class="tw-text-right" data-testid="member-health-exposed">
                    @if (row.exposed == null) {
                      <span class="tw-text-muted">{{
                        "keykeeperMemberHealthNotChecked" | i18n
                      }}</span>
                    } @else {
                      {{ row.exposed }}
                    }
                  </td>
                  <td bitCell data-testid="member-health-reported">{{ when(row.reportedAt) }}</td>
                }
              </tr>
            }
          </ng-template>
        </bit-table>
        @if (total.exposedUnchecked > 0) {
          <p class="tw-mt-3 tw-text-sm tw-text-muted">
            {{ "keykeeperMemberHealthExposedNote" | i18n }}
          </p>
        }
      }
    </bit-container>
  `,
})
export class KeykeeperMemberHealthReportComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly apiService = inject(ApiService);
  private readonly organizationUserApiService = inject(OrganizationUserApiService);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);

  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  /** The organization has "Members' own passwords" off. */
  protected readonly off = signal(false);
  protected readonly settingsLink = signal<string[]>([]);
  protected readonly rows = signal<MemberHealthRow[]>([]);
  protected readonly totals = computed(() => memberHealthTotals(this.rows()));

  protected readonly summary = computed(() => {
    const t = this.totals();
    const reported = this.i18nService.t(
      "keykeeperMemberHealthSummary",
      String(t.reported),
      String(t.members),
    );
    return t.reported === 0
      ? reported
      : `${reported} ${this.i18nService.t("keykeeperMemberHealthTotals", String(t.weak), String(t.reused))}`;
  });

  async ngOnInit() {
    const params = await firstValueFrom((this.route.parent?.parent ?? this.route).params);
    await this.load(params.organizationId);
  }

  async load(organizationId: string) {
    this.loading.set(true);
    this.failed.set(false);
    this.off.set(false);
    this.settingsLink.set(["/organizations", organizationId, "settings", "joining"]);
    try {
      const [response, members] = await Promise.all([
        this.apiService.send(
          "GET",
          `/keykeeper/organizations/${encodeURIComponent(organizationId)}/member-health`,
          null,
          true,
          true,
        ) as Promise<{ data?: MemberHealthReport[]; on?: boolean }>,
        this.organizationUserApiService.getAllMiniUserDetails(organizationId),
      ]);
      this.off.set(response?.on === false);
      this.rows.set(memberHealthRows(response?.data ?? [], members.data));
    } catch (e) {
      this.logService.error(e);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected when(date: string | null): string {
    return date == null
      ? ""
      : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(date));
  }
}
