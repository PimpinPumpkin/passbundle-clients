import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import { ClientEnrollment } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

type InstallState =
  | { kind: "own"; enrollment: ClientEnrollment }
  /** An MSP's client: its install command is in the MSP's console. */
  | { kind: "provider"; provider: string };

/**
 * Keykeeper: a company's own install command, on its organization's Settings
 * page, for owners and admins (the server answers no one else, and the card
 * stays hidden). The same command an MSP's console has for each client. See
 * DESIGN.md, "A company's own IT".
 */
@Component({
  selector: "app-keykeeper-org-install",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @if (state(); as s) {
      <section data-testid="org-install">
        <h1 bitTypography="h1" class="tw-mt-16 tw-pb-2.5">Install command</h1>
        @if (s.kind === "provider") {
          <p bitTypography="body1">
            {{ s.provider }} manages this organization's install command, in their MSP console.
          </p>
        } @else {
          <p bitTypography="body1">
            Run this on your organization's Windows computers as an administrator, from Intune,
            group policy, or your RMM. It installs the extension in Edge and Chrome with this server
            filled in, turns off the browsers' password managers, and anyone who then signs in joins
            the organization.
          </p>
          @if (s.enrollment.token; as token) {
            <pre
              class="tw-whitespace-pre-wrap tw-break-all tw-rounded tw-bg-background-alt tw-p-3 tw-text-sm"
              data-testid="org-install-command"
              >{{ installCommand(token) }}</pre>
            <p bitTypography="helper" data-testid="org-install-joins">
              {{ s.enrollment.joins === 1 ? "1 person has" : s.enrollment.joins + " people have" }}
              joined with this command.
              @if (s.enrollment.domains.length) {
                Only {{ domainList(s.enrollment.domains) }} accounts with a verified email can join
                with it.
              } @else {
                Anyone who has it can ask to join, so treat it like a password.
              }
            </p>
            <form
              [formGroup]="domainsForm"
              [bitSubmit]="saveDomains"
              class="tw-mb-3 tw-max-w-lg"
              aria-label="Email domains"
            >
              <bit-form-field>
                <bit-label>Only these email domains can join</bit-label>
                <input bitInput formControlName="domains" placeholder="example.com" />
                <bit-hint>
                  Separate domains with spaces or commas. Leave it empty to let anyone with the
                  command join. People you invite by email can join from any address.
                </bit-hint>
              </bit-form-field>
              <button bitButton bitFormButton buttonType="secondary" type="submit">
                Save domains
              </button>
            </form>
            <div class="tw-flex tw-gap-2">
              <button bitButton buttonType="primary" type="button" (click)="copyCommand(token)">
                Copy command
              </button>
              <button bitButton buttonType="danger" type="button" [bitAction]="replaceToken">
                Replace token
              </button>
            </div>
          } @else {
            <button bitButton buttonType="primary" type="button" [bitAction]="replaceToken">
              Create install command
            </button>
          }
        }
      </section>
    }
  `,
})
export class KeykeeperOrgInstallComponent {
  readonly organizationId = input.required<string>();

  protected readonly state = signal<InstallState | null>(null);
  protected readonly domainsForm = this.formBuilder.nonNullable.group({ domains: "" });
  private readonly serverUrl = signal("");

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperMspApiService,
    private readonly environmentService: EnvironmentService,
    private readonly i18nService: I18nService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {
    effect(() => {
      const id = this.organizationId();
      void this.load(id);
    });
  }

  private async load(orgId: string) {
    const environment = await firstValueFrom(this.environmentService.environment$);
    this.serverUrl.set(environment.getWebVaultUrl());
    try {
      const found = await this.api.getOrgEnrollment(orgId);
      if ("provider" in found) {
        this.state.set({ kind: "provider", provider: found.provider });
      } else {
        this.show(found);
      }
    } catch {
      // Not an owner or admin: the server says not found, and the card stays hidden.
      this.state.set(null);
    }
  }

  private show(enrollment: ClientEnrollment) {
    this.state.set({ kind: "own", enrollment });
    this.domainsForm.setValue({ domains: enrollment.domains.join(" ") });
  }

  private hasToken(): boolean {
    const s = this.state();
    return s?.kind === "own" && s.enrollment.token != null;
  }

  /** The command to run on each computer; the script's name comes from the brand. */
  protected installCommand(token: string): string {
    const script = this.i18nService.t("keykeeperInstallScript");
    return `.\\${script} -ServerUrl ${this.serverUrl()} -EnrollmentToken ${token}`;
  }

  protected domainList(domains: string[]): string {
    return domains.length < 2
      ? domains.join("")
      : `${domains.slice(0, -1).join(", ")} or ${domains[domains.length - 1]}`;
  }

  protected copyCommand(token: string) {
    this.platformUtilsService.copyToClipboard(this.installCommand(token));
    this.toastService.showToast({ variant: "success", message: "Copied the install command" });
  }

  protected readonly saveDomains = async () => {
    const domains = this.domainsForm
      .getRawValue()
      .domains.split(/[\s,;]+/)
      .filter((d) => d !== "");
    await this.attempt(async () => {
      const enrollment = await this.api.setOrgEnrollmentDomains(this.organizationId(), domains);
      this.show(enrollment);
      this.toastService.showToast({
        variant: "success",
        message: enrollment.domains.length
          ? `Only ${this.domainList(enrollment.domains)} accounts can join with the command`
          : "Anyone with the command can join",
      });
    });
  };

  protected readonly replaceToken = async () => {
    const hadToken = this.hasToken();
    if (hadToken) {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: "Replace the install token?",
        content:
          "Install commands already run on your computers stop letting new people join. Run the new command there instead.",
        acceptButtonText: "Replace token",
        type: "warning",
      });
      if (!confirmed) {
        return;
      }
    }
    await this.attempt(async () => {
      this.show(await this.api.replaceOrgEnrollment(this.organizationId()));
      this.toastService.showToast({
        variant: "success",
        message: hadToken ? "Replaced the install token" : "Created the install command",
      });
    });
  };

  private async attempt(work: () => Promise<void>) {
    try {
      await work();
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
