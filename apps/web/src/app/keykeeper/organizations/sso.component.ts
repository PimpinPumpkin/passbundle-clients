import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { SsoView } from "@bitwarden/admin-console/common";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

/**
 * Keykeeper: an organization's Single sign-on page, under Settings, for its
 * owners and admins and its MSP's admins (the server answers no one else).
 * They connect the organization's own Microsoft Entra tenant: the app
 * registration's client ID and secret, the identifier people type, and email
 * domains they prove with a DNS TXT record. Single sign-on proves who someone
 * is; their master password still unlocks. The secret is sent once and
 * never shown again. See DESIGN.md, "Sign in with Microsoft Entra ID".
 */
@Component({
  selector: "app-keykeeper-sso",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule, HeaderModule],
  template: `
    <app-header title="Single sign-on"></app-header>
    <bit-container>
      @if (refused()) {
        <p bitTypography="body1" data-testid="sso-refused">
          This organization's owners and admins, and its IT provider's admins, set up single
          sign-on.
        </p>
      } @else if (view(); as v) {
        <section data-testid="sso" class="tw-max-w-3xl">
          <p bitTypography="body1">
            Let people here sign in with their Microsoft 365 work account (Microsoft Entra ID).
            Microsoft confirms who they are; their master password still unlocks their items, so
            nobody, PassBundle included, can open them without it.
          </p>
          <p bitTypography="body2" data-testid="sso-status">
            @if (v.enabled) {
              Single sign-on is on.
              @if (v.requireSso) {
                Members must use it (owners and your IT provider's staff can still use their
                passwords).
              } @else {
                Members can use it or their password.
              }
            } @else {
              Single sign-on is off.
            }
          </p>

          <h2 bitTypography="h3" class="tw-mt-8">Redirect URI</h2>
          <p bitTypography="body2">
            Paste this into your Entra app registration, as a Web redirect URI.
          </p>
          <div class="tw-flex tw-items-center tw-gap-2">
            <code
              class="tw-break-all tw-rounded tw-bg-background-alt tw-px-3 tw-py-2 tw-text-sm"
              data-testid="sso-callback-url"
              >{{ v.callbackUrl }}</code
            >
            <button
              bitButton
              buttonType="secondary"
              type="button"
              (click)="copy(v.callbackUrl, 'redirect URI')"
            >
              Copy
            </button>
          </div>

          <h2 bitTypography="h3" class="tw-mt-8">Your Entra app</h2>
          <form
            [formGroup]="form"
            [bitSubmit]="save"
            class="tw-max-w-lg"
            aria-label="Single sign-on settings"
          >
            <bit-form-control>
              <input type="checkbox" bitCheckbox formControlName="enabled" />
              <bit-label>Turn on single sign-on</bit-label>
            </bit-form-control>
            <bit-form-field>
              <bit-label>SSO identifier</bit-label>
              <input bitInput formControlName="identifier" placeholder="acme-dental" />
              <bit-hint>
                What people type to find this sign-in, if their email's domain isn't verified below:
                3 to 40 lowercase letters, digits, and hyphens.
              </bit-hint>
            </bit-form-field>
            <bit-form-field>
              <bit-label>Directory (tenant) ID</bit-label>
              <input bitInput formControlName="tenantId" />
              <bit-hint>On the app registration's Overview page in Entra.</bit-hint>
            </bit-form-field>
            <bit-form-field>
              <bit-label>Application (client) ID</bit-label>
              <input bitInput formControlName="clientId" />
              <bit-hint>On the same Overview page.</bit-hint>
            </bit-form-field>
            <bit-form-field>
              <bit-label>Client secret value</bit-label>
              <input bitInput type="password" formControlName="clientSecret" autocomplete="off" />
              <bit-hint data-testid="sso-secret-hint">
                @if (v.secretSavedAt) {
                  Saved {{ v.secretSavedAt | date: "medium" }}. It's never shown again; leave this
                  empty to keep it, or paste a new one.
                } @else {
                  From Certificates & secrets in Entra: the secret's Value, not its Secret ID.
                }
              </bit-hint>
            </bit-form-field>
            <button bitButton bitFormButton buttonType="primary" type="submit">Save</button>
          </form>
          @if (v.signInUrl; as url) {
            <p bitTypography="body2" class="tw-mt-4" data-testid="sso-sign-in-url">
              A link that starts this sign-in, for an intranet page or a bookmark:
              <code class="tw-break-all">{{ url }}</code>
              <button bitLink type="button" class="tw-ml-2" (click)="copy(url, 'link')">
                Copy
              </button>
            </p>
          }

          <h2 bitTypography="h3" class="tw-mt-8">Email domains</h2>
          <p bitTypography="body2">
            Verify the domains your people's email addresses are at. Typing an email at one of them
            finds this sign-in, and accounts at them can be linked the first time someone signs in.
            Prove each domain with a TXT record in its DNS. A domain belongs to one organization.
          </p>
          @if (v.domains.length > 0) {
            <ul class="tw-list-none tw-p-0" data-testid="sso-domains">
              @for (d of v.domains; track d.id) {
                <li
                  class="tw-mb-4 tw-rounded tw-border tw-border-solid tw-border-secondary-300 tw-p-3"
                >
                  <div class="tw-flex tw-items-center tw-gap-2">
                    <strong>{{ d.domain }}</strong>
                    @if (d.verifiedAt) {
                      <span bitBadge variant="success">Verified</span>
                    } @else if (d.verifiedElsewhere) {
                      <span bitBadge variant="danger">Verified by another organization</span>
                    } @else {
                      <span bitBadge variant="warning">Not verified</span>
                    }
                  </div>
                  @if (!d.verifiedAt) {
                    <p bitTypography="helper" class="tw-mb-1 tw-mt-2">
                      Add this TXT record to {{ d.txtName }} (the domain itself, often written @),
                      then choose Verify. DNS changes can take a while to show.
                    </p>
                    <div class="tw-flex tw-items-center tw-gap-2">
                      <code class="tw-break-all tw-text-sm" data-testid="sso-domain-txt">{{
                        d.txtValue
                      }}</code>
                      <button bitLink type="button" (click)="copy(d.txtValue, 'TXT record')">
                        Copy
                      </button>
                    </div>
                    @if (d.lastCheckedAt) {
                      <p bitTypography="helper">
                        Last checked {{ d.lastCheckedAt | date: "medium" }}.
                      </p>
                    }
                  } @else {
                    <p bitTypography="helper">Verified {{ d.verifiedAt | date: "medium" }}.</p>
                  }
                  <div class="tw-mt-2 tw-flex tw-gap-2">
                    @if (!d.verifiedAt) {
                      <button
                        bitButton
                        buttonType="primary"
                        type="button"
                        [bitAction]="verifyAction(d.id)"
                      >
                        Verify
                      </button>
                    }
                    <button
                      bitButton
                      buttonType="secondary"
                      type="button"
                      [bitAction]="removeAction(d.id, d.domain)"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
          <form
            [formGroup]="domainForm"
            [bitSubmit]="addDomain"
            class="tw-max-w-lg"
            aria-label="Add an email domain"
          >
            <bit-form-field>
              <bit-label>Domain</bit-label>
              <input bitInput formControlName="domain" placeholder="acmedental.com" />
            </bit-form-field>
            <button bitButton bitFormButton buttonType="secondary" type="submit">Add domain</button>
          </form>

          @if (v.links.length > 0) {
            <h2 bitTypography="h3" class="tw-mt-8">Linked accounts</h2>
            <p bitTypography="body2">
              Each account signs in with the Microsoft account it was first linked to. Unlink one if
              its person's Microsoft account was replaced; their next sign-in links it again.
            </p>
            <ul class="tw-list-none tw-p-0" data-testid="sso-links">
              @for (l of v.links; track l.userId) {
                <li class="tw-flex tw-items-center tw-gap-2 tw-py-1">
                  <span>{{ l.email }}</span>
                  <span class="tw-text-sm tw-text-muted">
                    linked {{ l.linkedAt | date: "mediumDate"
                    }}{{ l.lastUsedAt ? ", last sign-in " + (l.lastUsedAt | date: "medium") : "" }}
                  </span>
                  <button bitLink type="button" (click)="unlink(l.userId, l.email)">Unlink</button>
                </li>
              }
            </ul>
          }

          <h2 bitTypography="h3" class="tw-mt-8">Requiring it</h2>
          <p bitTypography="body2" data-testid="sso-require">
            The Require single sign-on policy makes members sign in with it. Owners and your IT
            provider's staff can always use their passwords, so nobody is locked out, and account
            recovery keeps working. It needs single sign-on on and the Single organization policy.
            It's {{ v.requireSso ? "on" : "off" }}.
            <a bitLink [routerLink]="['/organizations', organizationId(), 'settings', 'policies']"
              >Policies</a
            >
          </p>

          <h2 bitTypography="h3" class="tw-mt-8">Setting up Entra</h2>
          <ol class="tw-list-decimal tw-pl-6" data-testid="sso-steps">
            <li>
              In the Microsoft Entra admin center, go to App registrations and choose New
              registration.
            </li>
            <li>
              Name it PassBundle. For Supported account types, choose accounts in this
              organizational directory only (single tenant).
            </li>
            <li>
              For Redirect URI, choose Web and paste the redirect URI from this page. Register.
            </li>
            <li>
              From the app's Overview page, copy the Application (client) ID and the Directory
              (tenant) ID here.
            </li>
            <li>
              In Certificates & secrets, add a new client secret and copy its Value here. Note when
              it expires: make a new one before then, or sign-in stops.
            </li>
            <li>
              In Token configuration, add the optional claims email and xms_edov to the ID token, so
              Microsoft says whether an email's domain is verified. If xms_edov isn't listed, add it
              to optionalClaims, idToken, in the app's Manifest.
            </li>
            <li>
              In API permissions, grant admin consent, so people aren't asked to consent the first
              time.
            </li>
            <li>
              Optionally, in Enterprise applications, open the app, set Assignment required to Yes,
              and assign the people who may sign in.
            </li>
            <li>Turn on single sign-on here, save, and verify your email domains.</li>
          </ol>
        </section>
      }
    </bit-container>
  `,
})
export class KeykeeperSsoComponent implements OnInit {
  protected readonly organizationId = signal("");
  /** Null while loading. */
  protected readonly view = signal<SsoView | null>(null);
  protected readonly refused = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    enabled: false,
    identifier: "",
    tenantId: "",
    clientId: "",
    clientSecret: "",
  });
  protected readonly domainForm = this.formBuilder.nonNullable.group({ domain: "" });

  constructor(
    private readonly route: ActivatedRoute,
    private readonly formBuilder: FormBuilder,
    private readonly api: KeykeeperMspApiService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly dialogService: DialogService,
    private readonly toastService: ToastService,
  ) {}

  async ngOnInit() {
    const params = await firstValueFrom(this.route.params);
    this.organizationId.set(params.organizationId);
    try {
      this.show(await this.api.getSso(this.organizationId()), true);
    } catch {
      this.refused.set(true);
    }
  }

  /** Shows the server's answer; the form follows it when it's the first load or a save. */
  private show(view: SsoView, resetForm = false) {
    this.view.set(view);
    if (resetForm) {
      this.form.setValue({
        enabled: view.enabled,
        identifier: view.identifier ?? "",
        tenantId: view.tenantId ?? "",
        clientId: view.clientId ?? "",
        // The secret never comes back; the field stays empty.
        clientSecret: "",
      });
    }
  }

  protected copy(value: string, what: string) {
    this.platformUtilsService.copyToClipboard(value);
    this.toastService.showToast({ variant: "success", message: `Copied the ${what}` });
  }

  protected readonly save = async () => {
    const f = this.form.getRawValue();
    await this.attempt(async () => {
      const view = await this.api.saveSso(this.organizationId(), {
        enabled: f.enabled,
        identifier: f.identifier.trim(),
        tenantId: f.tenantId.trim(),
        clientId: f.clientId.trim(),
        clientSecret: f.clientSecret.trim() === "" ? null : f.clientSecret.trim(),
      });
      this.show(view, true);
      this.toastService.showToast({
        variant: "success",
        message: view.enabled ? "Single sign-on is on" : "Saved single sign-on settings",
      });
    });
  };

  protected readonly addDomain = async () => {
    const domain = this.domainForm.getRawValue().domain.trim();
    if (domain === "") {
      return;
    }
    await this.attempt(async () => {
      this.show(await this.api.addSsoDomain(this.organizationId(), domain));
      this.domainForm.reset();
    });
  };

  protected verifyAction(domainId: string) {
    return async () => {
      await this.attempt(async () => {
        const view = await this.api.verifySsoDomain(this.organizationId(), domainId);
        this.show(view);
        if (view.check) {
          this.toastService.showToast(
            view.check.found
              ? { variant: "success", message: `Verified ${view.check.domain}` }
              : {
                  variant: "warning",
                  message: `The TXT record for ${view.check.domain} isn't there yet. DNS changes can take a while; try again later.`,
                },
          );
        }
      });
    };
  }

  protected removeAction(domainId: string, domain: string) {
    return async () => {
      const confirmed = await this.dialogService.openSimpleDialog({
        title: `Remove ${domain}?`,
        content:
          "Typing an email there no longer finds this sign-in, and accounts there can't be linked by it. Accounts already linked keep signing in.",
        acceptButtonText: "Remove",
        type: "warning",
      });
      if (!confirmed) {
        return;
      }
      await this.attempt(async () =>
        this.show(await this.api.removeSsoDomain(this.organizationId(), domainId)),
      );
    };
  }

  protected async unlink(userId: string, email: string) {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: `Unlink ${email}?`,
      content:
        "Their next single sign-on links their account again, to whichever Microsoft account signs in with their email, under the same rules.",
      acceptButtonText: "Unlink",
      type: "warning",
    });
    if (!confirmed) {
      return;
    }
    await this.attempt(async () =>
      this.show(await this.api.unlinkSso(this.organizationId(), userId)),
    );
  }

  private async attempt(work: () => Promise<void>) {
    try {
      await work();
    } catch (e) {
      const message = e instanceof ErrorResponse ? e.getSingleMessage() : String(e);
      this.toastService.showToast({ variant: "error", message });
    }
  }
}
