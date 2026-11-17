import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";

import { KeykeeperPricingLinkComponent } from "@bitwarden/angular/billing/keykeeper";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { KeykeeperPlanEnforced } from "@bitwarden/common/billing/keykeeper/keykeeper-plan";
import {
  InvoiceRow,
  invoiceRows,
  listsInvoices,
} from "@bitwarden/common/billing/keykeeper/plan-invoices";
import {
  dateInWords,
  planPageWords,
  PlanWhose,
  translateWith,
} from "@bitwarden/common/billing/keykeeper/plan-words";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { planInvoices, providerPageAddress } from "./plan-api";

/**
 * Keykeeper: one plan, on the Plan page (DESIGN.md, "Plans and billing",
 * "Upstream's billing pages go"): its name, its state and dates in words,
 * whether an MSP covers it, what it gives, and one button that opens the
 * provider's page. The button is there only when the server says the person
 * can pay; until a provider is set, it never is. For a plan billed by the day
 * (an MSP's pool, or Business with no MSP), the button adds a card, and the
 * page lists the months the server invoiced, with what each amount comes
 * from.
 */
@Component({
  selector: "app-keykeeper-plan-view",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, KeykeeperPricingLinkComponent],
  template: `
    @let w = words();
    <section
      class="tw-mb-8 tw-max-w-3xl"
      data-testid="keykeeper-plan"
      [attr.data-state]="plan().state ?? 'none'"
      [attr.aria-label]="'keykeeperPlanNav' | i18n"
    >
      <h2 bitTypography="h3" class="tw-mb-2" data-testid="keykeeper-plan-name">{{ w.name }}</h2>
      @for (line of w.status; track $index) {
        <p bitTypography="body1" class="tw-mb-1" data-testid="keykeeper-plan-status">
          {{ line }}
        </p>
      }
      @if (w.coveredBy) {
        <p bitTypography="body1" class="tw-mb-1" data-testid="keykeeper-plan-covered-by">
          {{ w.coveredBy }}
        </p>
      }
      @if (w.gives.length > 0) {
        <h3 bitTypography="h5" class="tw-mt-6 tw-mb-2">{{ "keykeeperPlanIncludes" | i18n }}</h3>
        <ul class="tw-ps-5 tw-mb-0" data-testid="keykeeper-plan-gives">
          @for (line of w.gives; track $index) {
            <li bitTypography="body1" class="tw-mb-1">{{ line }}</li>
          }
        </ul>
      }
      @if (w.note) {
        <p bitTypography="body1" class="tw-mt-6 tw-mb-0" data-testid="keykeeper-plan-note">
          {{ w.note }}
          @if (w.noteIsPremium) {
            <billing-keykeeper-pricing-link />
          }
        </p>
      }
      @if (w.action; as action) {
        <button
          bitButton
          buttonType="primary"
          type="button"
          class="tw-mt-6"
          data-testid="keykeeper-plan-button"
          [bitAction]="openProviderPage"
        >
          {{ action.label }}
        </button>
      }
      @if (invoices(); as rows) {
        <section
          class="tw-mt-8"
          data-testid="keykeeper-plan-invoices"
          [attr.aria-label]="'keykeeperPlanInvoices' | i18n"
        >
          <h3 bitTypography="h5" class="tw-mb-2">{{ "keykeeperPlanInvoices" | i18n }}</h3>
          <p bitTypography="body2" class="tw-mb-2">{{ "keykeeperPlanInvoicesHow" | i18n }}</p>
          @if (rows.length === 0) {
            <p
              bitTypography="body2"
              class="tw-mb-0 tw-text-muted"
              data-testid="keykeeper-plan-invoices-none"
            >
              {{ "keykeeperPlanInvoicesNone" | i18n }}
            </p>
          } @else {
            <bit-table>
              <ng-container header>
                <tr>
                  <th bitCell>{{ "keykeeperPlanInvoiceMonth" | i18n }}</th>
                  <th bitCell>{{ "keykeeperPlanInvoiceSeatDays" | i18n }}</th>
                  <th bitCell>{{ "keykeeperPlanInvoiceProrated" | i18n }}</th>
                  <th bitCell>{{ "keykeeperPlanInvoicePrice" | i18n }}</th>
                  <th bitCell>{{ "keykeeperPlanInvoiceAmount" | i18n }}</th>
                  <th bitCell>{{ "keykeeperPlanInvoiceState" | i18n }}</th>
                </tr>
              </ng-container>
              <ng-template body>
                @for (row of rows; track row.month) {
                  <tr bitRow data-testid="keykeeper-plan-invoice">
                    <td bitCell>{{ row.month }}</td>
                    <td bitCell>
                      {{ row.seatDays }}
                      @if (row.freeDays) {
                        <span class="tw-text-muted"> ({{ row.freeDays }})</span>
                      }
                    </td>
                    <td bitCell>{{ row.prorated }}</td>
                    <td bitCell>{{ row.price }}</td>
                    <td bitCell>{{ row.amount }}</td>
                    <td bitCell>{{ row.state }}</td>
                  </tr>
                }
              </ng-template>
            </bit-table>
          }
        </section>
      }
    </section>
  `,
})
export class KeykeeperPlanViewComponent {
  private readonly i18n = inject(I18nService);
  private readonly apiService = inject(ApiService);
  private readonly platformUtils = inject(PlatformUtilsService);
  private readonly toastService = inject(ToastService);

  readonly plan = input.required<KeykeeperPlanEnforced>();
  readonly whose = input.required<PlanWhose>();
  /** A person only: the profile says Premium's features come through an organization or an MSP. */
  readonly premiumThroughOrganization = input(false);

  private readonly date = dateInWords(this.i18n.translationLocale);

  /** The plan's invoices in words, where the page lists them; null where it doesn't. */
  protected readonly invoices = signal<InvoiceRow[] | null>(null);
  /** Which asking for invoices is the latest, so an earlier answer never replaces it. */
  private readonly asking = { latest: 0 };

  constructor() {
    effect(() => {
      const plan = this.plan();
      const whose = this.whose();
      const asking = ++this.asking.latest;
      if (!listsInvoices(plan, whose)) {
        this.invoices.set(null);
        return;
      }
      void planInvoices(this.apiService, whose).then(
        (invoices) => {
          if (asking === this.asking.latest) {
            this.invoices.set(
              invoiceRows(invoices, translateWith(this.i18n), this.i18n.translationLocale),
            );
          }
        },
        () => {
          if (asking === this.asking.latest) {
            this.invoices.set(null);
          }
        },
      );
    });
  }

  protected readonly words = computed(() =>
    planPageWords(
      this.plan(),
      this.whose(),
      translateWith(this.i18n),
      this.date,
      this.premiumThroughOrganization(),
    ),
  );

  /** Asks the server for the provider's page and opens it in a new tab. */
  protected readonly openProviderPage = async () => {
    const action = this.words().action?.action;
    if (action == null) {
      return;
    }
    try {
      const address = await providerPageAddress(this.apiService, action, this.whose(), this.plan());
      this.platformUtils.launchUri(address);
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    }
  };
}
