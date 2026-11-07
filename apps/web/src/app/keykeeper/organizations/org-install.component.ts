import { ChangeDetectionStrategy, Component, effect, input, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import { ClientEnrollment } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";
import { KeykeeperJoinSealer } from "../joining/join-sealer.service";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperInstallCommandComponent, ShownInstallParts } from "./install-command.component";

type InstallState =
  | { kind: "own"; enrollment: ClientEnrollment; parts: ShownInstallParts | null }
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
  imports: [SharedModule, KeykeeperInstallCommandComponent],
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
            Run it on your organization's computers to turn off the browsers' own password saving,
            and to install the extension, once it's in the Chrome and Edge stores, with this server
            filled in. Anyone who then signs in joins the organization.
          </p>
          @if (s.enrollment.token; as token) {
            <app-keykeeper-install-command
              [token]="token"
              [parts]="s.parts"
              [serverUrl]="serverUrl()"
              whose="your organization's"
              joins="the organization"
              testIdPrefix="org-install"
            />
            <p bitTypography="helper" data-testid="org-install-joins">
              {{ s.enrollment.joins === 1 ? "1 person has" : s.enrollment.joins + " people have" }}
              joined with this command.
              @if (s.enrollment.domains.length) {
                Only {{ domainList(s.enrollment.domains) }} accounts with a verified email can join
                with it.
              } @else {
                Anyone who has it can ask to join, and an owner or admin approves each one, so treat
                it like a password.
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
  protected readonly serverUrl = signal("");

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperMspApiService,
    private readonly environmentService: EnvironmentService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
    private readonly sealer: KeykeeperJoinSealer,
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
        await this.show(found);
      }
    } catch {
      // Not an owner or admin: the server says not found, and the card stays hidden.
      this.state.set(null);
    }
  }

  /**
   * Shows the command with its join secret and the organization's key
   * fingerprint. A command made before join secrets gets one now, keeping
   * its token: only owners and admins see this card.
   */
  private async show(enrollment: ClientEnrollment) {
    const orgId = this.organizationId();
    let parts = await this.sealer.commandParts(orgId, enrollment.secret);
    if (parts == null && enrollment.token != null && enrollment.secret == null) {
      await this.api.setOrgEnrollmentSecret(orgId);
      const found = await this.api.getOrgEnrollment(orgId);
      if (!("provider" in found)) {
        enrollment = found;
        parts = await this.sealer.commandParts(orgId, enrollment.secret);
      }
    }
    this.state.set({ kind: "own", enrollment, parts });
    this.domainsForm.setValue({ domains: enrollment.domains.join(" ") });
  }

  private hasToken(): boolean {
    const s = this.state();
    return s?.kind === "own" && s.enrollment.token != null;
  }

  protected domainList(domains: string[]): string {
    return domains.length < 2
      ? domains.join("")
      : `${domains.slice(0, -1).join(", ")} or ${domains[domains.length - 1]}`;
  }

  protected readonly saveDomains = async () => {
    const domains = this.domainsForm
      .getRawValue()
      .domains.split(/[\s,;]+/)
      .filter((d) => d !== "");
    await this.attempt(async () => {
      const enrollment = await this.api.setOrgEnrollmentDomains(this.organizationId(), domains);
      await this.show(enrollment);
      this.toastService.showToast({
        variant: "success",
        message: enrollment.domains.length
          ? `Only ${this.domainList(enrollment.domains)} accounts can join with the command`
          : "Anyone with the command can ask to join",
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
      await this.show(await this.api.replaceOrgEnrollment(this.organizationId()));
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
