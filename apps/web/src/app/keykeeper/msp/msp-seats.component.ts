import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormControl } from "@angular/forms";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { FileDownloadService } from "@bitwarden/common/platform/abstractions/file-download/file-download.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import {
  averageText,
  getMspSeats,
  getMspSeatsCsv,
  monthLabel,
  MspSeats,
  seatsCsvFile,
  WHAT_COUNTS,
} from "./msp-seats";

/**
 * Keykeeper: seats by client in the MSP console, for MSP admins who bill
 * each client for its own seats: a month's most seats on any day, average,
 * and today's for each client, with totals, and the same as a CSV file.
 * See DESIGN.md, "Seats by client".
 */
@Component({
  selector: "app-keykeeper-msp-seats",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (seats(); as s) {
      <section class="tw-mt-8" aria-label="Seats" data-testid="msp-seats">
        <h2 bitTypography="h3">Seats</h2>
        <p bitTypography="body2" data-testid="msp-seats-what-counts">{{ whatCounts }}</p>
        <div class="tw-flex tw-flex-wrap tw-items-end tw-gap-4">
          <bit-form-field disableMargin class="tw-w-72 tw-max-w-full">
            <bit-label>Month</bit-label>
            <select bitInput [formControl]="month">
              @for (m of s.months; track m) {
                <option [value]="m">{{ optionLabel(m) }}</option>
              }
            </select>
          </bit-form-field>
          <button
            bitButton
            buttonType="secondary"
            type="button"
            [disabled]="downloading()"
            (click)="download()"
          >
            Download CSV
          </button>
        </div>
        @if (s.clients.length === 0) {
          <p bitTypography="body2" class="tw-mt-4 tw-text-muted">
            No clients in {{ label(s.month) }}.
          </p>
        } @else {
          <bit-table class="tw-mt-4">
            <ng-container header>
              <tr>
                <th bitCell>Client</th>
                <th bitCell>Most on any day</th>
                <th bitCell>Average</th>
                @if (s.thisMonth) {
                  <th bitCell>Today</th>
                }
              </tr>
            </ng-container>
            <ng-template body>
              @for (c of s.clients; track c.id) {
                <tr bitRow [attr.data-testid]="'msp-seats-' + c.name">
                  <td bitCell>
                    {{ c.name }}
                    @if (!c.current) {
                      <span class="tw-text-muted"> (no longer a client)</span>
                    }
                  </td>
                  <td bitCell data-testid="msp-seats-most">{{ c.most }}</td>
                  <td bitCell data-testid="msp-seats-average">{{ average(c.average) }}</td>
                  @if (s.thisMonth) {
                    <td bitCell data-testid="msp-seats-today">{{ c.today ?? "-" }}</td>
                  }
                </tr>
              }
              <tr bitRow class="tw-font-semibold" data-testid="msp-seats-total">
                <td bitCell>Total</td>
                <td bitCell data-testid="msp-seats-most">{{ s.totals.most }}</td>
                <td bitCell data-testid="msp-seats-average">{{ average(s.totals.average) }}</td>
                @if (s.thisMonth) {
                  <td bitCell data-testid="msp-seats-today">{{ s.totals.today ?? 0 }}</td>
                }
              </tr>
            </ng-template>
          </bit-table>
        }
      </section>
    }
  `,
})
export class KeykeeperMspSeatsComponent {
  readonly mspId = input.required<string>();

  protected readonly seats = signal<MspSeats | null>(null);
  protected readonly thisMonth = signal<string | null>(null);
  protected readonly downloading = signal(false);
  protected readonly month = new FormControl("", { nonNullable: true });
  protected readonly whatCounts = WHAT_COUNTS;
  protected readonly label = monthLabel;
  protected readonly average = averageText;

  constructor(
    private readonly apiService: ApiService,
    private readonly fileDownloadService: FileDownloadService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.mspId();
      void this.load(id);
    });
    this.month.valueChanges.pipe(takeUntilDestroyed()).subscribe((month) => {
      if (month !== "" && month !== this.seats()?.month) {
        void this.load(this.mspId(), month);
      }
    });
  }

  protected optionLabel(month: string) {
    const label = monthLabel(month);
    return month === this.thisMonth() ? `${label} (this month)` : label;
  }

  private async load(mspId: string, month?: string) {
    try {
      const seats = await getMspSeats(this.apiService, mspId, month);
      if (seats.thisMonth) {
        this.thisMonth.set(seats.month);
      }
      this.seats.set(seats);
      this.month.setValue(seats.month, { emitEvent: false });
    } catch (e) {
      if (month == null) {
        // An older server, or someone who isn't an MSP admin: no section.
        this.seats.set(null);
        return;
      }
      this.month.setValue(this.seats()?.month ?? "", { emitEvent: false });
      this.toastService.showToast({
        variant: "error",
        message: plainErrorMessage(e),
      });
    }
  }

  protected async download() {
    const month = this.seats()?.month;
    if (month == null) {
      return;
    }
    this.downloading.set(true);
    try {
      const csv = await getMspSeatsCsv(this.apiService, this.mspId(), month);
      this.fileDownloadService.download({
        fileName: `seats-${month}.csv`,
        blobData: seatsCsvFile(csv),
        blobOptions: { type: "text/csv;charset=utf-8" },
      });
    } catch (e) {
      this.toastService.showToast({
        variant: "error",
        message: plainErrorMessage(e),
      });
    } finally {
      this.downloading.set(false);
    }
  }
}
