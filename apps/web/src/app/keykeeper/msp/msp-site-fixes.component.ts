import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from "@angular/core";

import { MspSiteFixes, SiteFixView } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { describeFingerprint, describeSource } from "@bitwarden/common/vault/keykeeper/fill-rules";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { KeykeeperMspApiService } from "./msp-api.service";

/** How a fix finds its field, in a few words (the same words as an item's fill rules). */
export function describeField(fix: SiteFixView): string {
  return describeFingerprint(fix.field);
}

/** Whether two fixes are the same one. */
const same = (a: SiteFixView, b: SiteFixView) =>
  a.host === b.host &&
  a.fill === b.fill &&
  a.field.id === b.field.id &&
  a.field.name === b.field.name &&
  a.field.label === b.field.label;

/**
 * Keykeeper: site fixes in the MSP console, for MSP admins. Fixes the MSP's
 * staff share from the fill picker show here with who sent them; "Use for
 * every client" makes one a site rule that fills for everyone in the MSP's
 * clients at once. See DESIGN.md, "Site fixes (opt-in)".
 */
@Component({
  selector: "app-keykeeper-msp-site-fixes",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (fixes(); as f) {
      <section class="tw-mt-8" data-testid="msp-site-fixes">
        <h2 bitTypography="h3">Site fixes</h2>
        <p bitTypography="body2">
          When a site doesn't fill right, fix it with the fill picker: right-click the field, then
          Fill this field with. Staff who share their fixes (the extension's Autofill settings) see
          them here, and one you use for every client fills for everyone in your clients. A fix says
          which kind of value goes in a field, never what's in it.
        </p>
        <h3 bitTypography="h5">Used for every client</h3>
        <ul class="tw-mb-4 tw-ps-0" data-testid="msp-site-rules">
          @for (rule of f.rules; track rule.id) {
            <li
              class="tw-mb-1 tw-flex tw-items-center tw-gap-2"
              [attr.data-testid]="'msp-site-rule-' + rule.host"
            >
              <span
                >On <strong>{{ rule.host }}</strong
                >, {{ field(rule) }} gets {{ fill(rule) }}.</span
              >
              <button
                bitButton
                buttonType="secondary"
                size="small"
                type="button"
                (click)="remove(rule.id)"
              >
                Remove
              </button>
            </li>
          } @empty {
            <li class="tw-list-none tw-text-muted">None yet.</li>
          }
        </ul>
        <h3 bitTypography="h5">Shared by your staff</h3>
        <ul class="tw-ps-0" data-testid="msp-site-shared">
          @for (fix of shared(); track fix.id) {
            <li
              class="tw-mb-1 tw-flex tw-items-center tw-gap-2"
              [attr.data-testid]="'msp-site-shared-' + fix.host"
            >
              <span>
                On <strong>{{ fix.host }}</strong
                >, {{ field(fix) }} gets {{ fill(fix) }}
                <span class="tw-text-muted">({{ fix.reportedBy }})</span>
              </span>
              <button bitButton buttonType="primary" size="small" type="button" (click)="use(fix)">
                Use for every client
              </button>
            </li>
          } @empty {
            <li class="tw-list-none tw-text-muted">None yet.</li>
          }
        </ul>
      </section>
    }
  `,
})
export class KeykeeperMspSiteFixesComponent {
  readonly mspId = input.required<string>();

  protected readonly fixes = signal<MspSiteFixes | null>(null);
  /** Shared fixes that aren't a rule yet, each once. */
  protected readonly shared = computed(() => {
    const f = this.fixes();
    if (f == null) {
      return [];
    }
    const out: MspSiteFixes["shared"] = [];
    for (const fix of f.shared) {
      if (!f.rules.some((r) => same(r, fix)) && !out.some((o) => same(o, fix))) {
        out.push(fix);
      }
    }
    return out;
  });

  constructor(
    private readonly api: KeykeeperMspApiService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.mspId();
      void this.load(id);
    });
  }

  protected field(fix: SiteFixView) {
    return describeField(fix);
  }

  protected fill(fix: SiteFixView) {
    return describeSource({ from: fix.fill });
  }

  private async load(mspId: string) {
    try {
      this.fixes.set(await this.api.getSiteFixes(mspId));
    } catch {
      // An older server: no section.
      this.fixes.set(null);
    }
  }

  protected async use(fix: SiteFixView) {
    await this.attempt(async () => {
      await this.api.addSiteRule(this.mspId(), fix);
      this.toastService.showToast({
        variant: "success",
        message: `${fix.host}'s fix now fills for every client`,
      });
    });
  }

  protected async remove(ruleId: string) {
    await this.attempt(async () => {
      await this.api.removeSiteRule(this.mspId(), ruleId);
      this.toastService.showToast({ variant: "success", message: "Removed the site fix" });
    });
  }

  private async attempt(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      this.toastService.showToast({
        variant: "error",
        message: e instanceof ErrorResponse ? e.getSingleMessage() : String(e),
      });
    }
    await this.load(this.mspId());
  }
}
