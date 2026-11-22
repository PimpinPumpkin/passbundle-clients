import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from "@angular/core";

import { MspDetails, MspLinkCode } from "@bitwarden/admin-console/common";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

import { KeykeeperMspApiService } from "./msp-api.service";

/**
 * Keykeeper: in the MSP console, for MSP admins, bringing in an organization
 * that already uses PassBundle: a one-time code for its owner, shown once,
 * which works once and for 7 days, and the codes nobody has used yet, to
 * revoke. Its owner enters the code on its Members page, sees who would be
 * added, and says yes; then they confirm one of the MSP's admins there,
 * comparing fingerprint phrases, and once that admin confirms the client, the
 * rest of the staff get in as in any client, with no phrase compared
 * (DESIGN.md, "An organization that already uses PassBundle").
 */
@Component({
  selector: "app-keykeeper-msp-link-codes",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, SharedModule],
  template: `
    @if (msp().role === "admin") {
      <section class="tw-mt-6" data-testid="msp-link-codes">
        <h3 bitTypography="h5">Bring in an organization that already uses PassBundle</h3>
        <p bitTypography="body2">
          Give its owner a code. They enter it on their organization's Members page, see who from
          {{ msp().name }} would be added, and say yes. A code works once, for 7 days.
        </p>
        <p bitTypography="body2" data-testid="msp-link-codes-then">
          {{ "keykeeperMspLinkCodesThen" | i18n }}
        </p>
        <form class="tw-flex tw-items-end tw-gap-2" (submit)="make($event)">
          <bit-form-field disableMargin class="tw-grow">
            <bit-label>Who it's for (optional)</bit-label>
            <input
              bitInput
              type="text"
              maxlength="100"
              [value]="label()"
              (input)="label.set($any($event.target).value)"
            />
          </bit-form-field>
          <button bitButton buttonType="primary" type="submit" [disabled]="busy()">
            Make a code
          </button>
        </form>
        @if (made(); as code) {
          <bit-callout
            type="success"
            [title]="null"
            class="tw-mt-3"
            data-testid="msp-link-code-made"
          >
            <p class="tw-mb-1" bitTypography="body2">
              The code{{ code.label ? " for " + code.label : "" }}, shown only now. Send it to the
              organization's owner; it works until {{ code.expiresAt | date: "medium" }}.
            </p>
            <pre class="tw-mb-1 tw-text-lg" data-testid="msp-link-code">{{ code.code }}</pre>
            <button
              bitButton
              buttonType="secondary"
              size="small"
              type="button"
              (click)="copy(code)"
            >
              Copy
            </button>
          </bit-callout>
        }
        @if (codes().length > 0) {
          <h4 bitTypography="h6" class="tw-mb-1 tw-mt-4">Codes nobody has used yet</h4>
          <ul class="tw-m-0 tw-list-none tw-p-0">
            @for (code of codes(); track code.id) {
              <li class="tw-flex tw-items-center tw-gap-2 tw-py-1" data-testid="msp-link-code-open">
                <span bitTypography="body2" class="tw-grow">
                  {{ code.label || "A code" }}, made by {{ code.createdBy }}, works until
                  {{ code.expiresAt | date: "medium" }}
                </span>
                <button
                  bitButton
                  buttonType="danger"
                  size="small"
                  type="button"
                  [attr.aria-label]="'Revoke ' + (code.label || 'the code')"
                  (click)="revoke(code)"
                >
                  Revoke
                </button>
              </li>
            }
          </ul>
        }
        @if (joined().length > 0) {
          <h4 bitTypography="h6" class="tw-mb-1 tw-mt-4">Joined with a code</h4>
          <ul class="tw-mb-0 tw-ps-5 tw-list-disc">
            @for (client of joined(); track client.id) {
              <li bitTypography="body2" [attr.data-testid]="'msp-link-joined-' + client.name">
                {{ client.name }}:
                {{
                  client.you?.status === 2
                    ? client.seal
                      ? "your staff get in as in any client."
                      : "you're confirmed there. Use Confirm client on its row."
                    : "waiting for its owner to confirm you, on its Members page."
                }}
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class KeykeeperMspLinkCodesComponent {
  readonly msp = input.required<MspDetails>();

  protected readonly label = signal("");
  protected readonly codes = signal<MspLinkCode[]>([]);
  protected readonly made = signal<MspLinkCode | null>(null);
  protected readonly busy = signal(false);

  /** The MSP's clients that joined with a code, and where each stands. */
  protected readonly joined = computed(() => this.msp().clients.filter((c) => c.joinedWithCode));

  constructor(
    private readonly mspApi: KeykeeperMspApiService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
    private readonly platformUtilsService: PlatformUtilsService,
  ) {
    effect(() => {
      const msp = this.msp();
      this.made.set(null);
      if (msp.role === "admin") {
        void this.load(msp.id);
      }
    });
  }

  private async load(mspId: string) {
    try {
      this.codes.set(await this.mspApi.linkCodes(mspId));
    } catch {
      // Shown to anyone the server answers; otherwise, nothing to list.
      this.codes.set([]);
    }
  }

  protected async make(event: Event) {
    event.preventDefault();
    this.busy.set(true);
    try {
      const code = await this.mspApi.makeLinkCode(this.msp().id, this.label());
      this.made.set(code);
      this.label.set("");
      await this.load(this.msp().id);
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(code: MspLinkCode) {
    if (code.code != null) {
      this.platformUtilsService.copyToClipboard(code.code);
      this.toastService.showToast({ variant: "success", message: "Copied the code" });
    }
  }

  protected async revoke(code: MspLinkCode) {
    const what = code.label ? `the code for ${code.label}` : "this code";
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Revoke ${what}?`,
      content: "It stops working at once. You can make another.",
      acceptButtonText: "Revoke",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.mspApi.revokeLinkCode(this.msp().id, code.id);
      if (this.made()?.id === code.id) {
        this.made.set(null);
      }
      await this.load(this.msp().id);
    } catch (e) {
      this.toastService.showToast({ variant: "error", message: plainErrorMessage(e) });
    }
  }
}
