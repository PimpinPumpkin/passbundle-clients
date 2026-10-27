import { ChangeDetectionStrategy, Component, OnInit, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { KEYKEEPER_SSO_LINK_SESSION, KeykeeperSsoLinkSession } from "@bitwarden/auth/angular";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { ToastService } from "@bitwarden/components";

import { SharedModule } from "../../shared";

/** What the server says about a link waiting to be confirmed. */
type PendingLink = {
  organizationName: string | null;
  identifier: string | null;
  accountEmail: string | null;
  microsoftName: string | null;
  microsoftEmail: string | null;
  error: string | null;
};

/**
 * Keykeeper: linking an account to an organization's single sign-on, the web
 * vault's half (DESIGN.md, "Sign in with Microsoft Entra ID").
 *
 * - Started here by someone an organization requires to use single sign-on
 *   who isn't linked yet: their password and two-step login got a linking
 *   session (kept in this tab), which asks for a ticket and goes to Microsoft.
 * - Microsoft's answer comes back here with a pending link's code, for a
 *   linking session or a signed-in one (Link SSO in an organization's menu).
 *   The page shows which Microsoft account it is, and the session that asked
 *   confirms it. Only then is the link made.
 */
@Component({
  selector: "app-keykeeper-sso-link",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @switch (step()) {
      @case ("start") {
        <div data-testid="sso-link-start">
          <p bitTypography="body1">
            Your organization requires single sign-on, and your account isn't linked to it yet. Link
            your Microsoft 365 work account to continue.
          </p>
          <p bitTypography="body2">
            Microsoft asks which account to use, and you confirm it here before anything is linked.
            After that, you sign in with Microsoft, and your master password still unlocks your
            vault.
          </p>
          <button
            bitButton
            buttonType="primary"
            type="button"
            [block]="true"
            [loading]="busy()"
            (click)="start()"
          >
            Continue with Microsoft
          </button>
        </div>
      }
      @case ("pending") {
        @if (pending(); as p) {
          <div data-testid="sso-link-confirm">
            <p bitTypography="body1">Link this Microsoft account to your PassBundle account?</p>
            <dl class="tw-mb-4 tw-grid tw-grid-cols-[auto_1fr] tw-gap-x-4 tw-gap-y-1">
              <dt class="tw-font-semibold">Microsoft account</dt>
              <dd data-testid="sso-link-microsoft">
                {{
                  p.microsoftName
                    ? p.microsoftName + " (" + p.microsoftEmail + ")"
                    : p.microsoftEmail
                }}
              </dd>
              <dt class="tw-font-semibold">PassBundle account</dt>
              <dd data-testid="sso-link-account">{{ p.accountEmail }}</dd>
              <dt class="tw-font-semibold">Organization</dt>
              <dd>{{ p.organizationName }}</dd>
            </dl>
            <p bitTypography="body2">
              Only link a Microsoft account that's yours: it will sign in to this PassBundle
              account. You'll get an email about it.
            </p>
            <div class="tw-flex tw-gap-2">
              <button
                bitButton
                buttonType="primary"
                type="button"
                [loading]="busy()"
                (click)="confirm()"
              >
                Link accounts
              </button>
              <button bitButton buttonType="secondary" type="button" (click)="leave()">
                Cancel
              </button>
            </div>
          </div>
        }
      }
      @case ("problem") {
        <div data-testid="sso-link-problem">
          <p bitTypography="body1">{{ problem() }}</p>
          <button bitButton buttonType="secondary" type="button" (click)="leave()">
            {{ linking() ? "Back to sign in" : "Back to your vault" }}
          </button>
        </div>
      }
      @default {
        <p bitTypography="body2">Loading…</p>
      }
    }
  `,
})
export class KeykeeperSsoLinkComponent implements OnInit {
  protected readonly step = signal<"loading" | "start" | "pending" | "problem">("loading");
  protected readonly pending = signal<PendingLink | null>(null);
  protected readonly problem = signal("");
  protected readonly busy = signal(false);
  /** The linking session in this tab, if there is one. */
  protected readonly linking = signal<KeykeeperSsoLinkSession | null>(null);
  private readonly code = signal<string | null>(null);

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly apiService: ApiService,
    private readonly environmentService: EnvironmentService,
    private readonly toastService: ToastService,
  ) {}

  async ngOnInit() {
    this.linking.set(readLinkingSession());
    const params = await firstValueFrom(this.route.queryParams);
    if (typeof params.code === "string" && params.code !== "") {
      this.code.set(params.code);
      try {
        const p = (await this.call("/accounts/sso/link/pending", {
          code: this.code(),
        })) as PendingLink;
        if (p.error) {
          this.fail(p.error);
        } else {
          this.pending.set(p);
          this.step.set("pending");
        }
      } catch (e) {
        this.fail(errorMessage(e));
      }
      return;
    }
    if (this.linking()?.identifier === params.identifier && params.identifier != null) {
      this.step.set("start");
      return;
    }
    this.fail("This request to link single sign-on expired. Sign in again.");
  }

  /** Gets a ticket with the linking session and goes to Microsoft. */
  protected async start() {
    const linking = this.linking();
    if (linking == null) {
      return;
    }
    this.busy.set(true);
    try {
      const ticket = (await this.call("/accounts/sso/user-identifier", {})) as string;
      const env = await firstValueFrom(this.environmentService.environment$);
      const random = (n: number) =>
        Utils.fromArrayToUrlB64(crypto.getRandomValues(new Uint8Array(n)));
      const verifier = random(48);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = Utils.fromArrayToUrlB64(new Uint8Array(digest));
      const identifier = linking.identifier;
      const state = `${random(24)}_identifier=${identifier}`;
      const url =
        `${env.getIdentityUrl()}/connect/authorize?client_id=web` +
        `&redirect_uri=${encodeURIComponent(window.location.origin + "/sso-connector.html")}` +
        `&response_type=code&scope=${encodeURIComponent("api offline_access")}` +
        `&state=${encodeURIComponent(state)}&code_challenge=${challenge}&code_challenge_method=S256` +
        `&response_mode=query&domain_hint=${encodeURIComponent(identifier)}` +
        `&user_identifier=${encodeURIComponent(ticket)}`;
      window.location.assign(url);
    } catch (e) {
      this.busy.set(false);
      this.fail(errorMessage(e));
    }
  }

  /** The session that asked confirms the link. */
  protected async confirm() {
    this.busy.set(true);
    try {
      const done = (await this.call("/accounts/sso/link/confirm", { code: this.code() })) as {
        identifier: string;
      };
      if (this.linking() != null) {
        // The linking session ended with the link: now single sign-on.
        sessionStorage.removeItem(KEYKEEPER_SSO_LINK_SESSION);
        this.toastService.showToast({
          variant: "success",
          title: "",
          message: "Your Microsoft account is linked. Sign in with it to continue.",
        });
        await this.router.navigate(["/sso"], { queryParams: { identifier: done.identifier } });
      } else {
        this.toastService.showToast({
          variant: "success",
          title: "",
          message: "Your Microsoft account is linked. Next time, sign in with it.",
        });
        await this.router.navigate(["/vault"]);
      }
    } catch (e) {
      this.busy.set(false);
      this.fail(errorMessage(e));
    }
  }

  protected async leave() {
    if (this.linking() != null) {
      sessionStorage.removeItem(KEYKEEPER_SSO_LINK_SESSION);
      await this.router.navigate(["/login"]);
    } else {
      await this.router.navigate(["/vault"]);
    }
  }

  private fail(message: string) {
    this.problem.set(message);
    this.step.set("problem");
  }

  /**
   * A link request: with the linking session if this tab has one (it isn't a
   * login, so only the link requests take it), otherwise as the signed-in
   * account.
   */
  private async call(path: string, body: unknown): Promise<unknown> {
    const linking = this.linking();
    if (linking == null) {
      return this.apiService.send("POST", path, body, true, true);
    }
    const env = await firstValueFrom(this.environmentService.environment$);
    const response = await fetch(env.getApiUrl() + path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Authorization: `Bearer ${linking.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch((): unknown => null);
    if (!response.ok) {
      throw new Error(serverMessage(json) ?? "Something went wrong. Sign in again.");
    }
    return json;
  }
}

function readLinkingSession(): KeykeeperSsoLinkSession | null {
  try {
    const raw = sessionStorage.getItem(KEYKEEPER_SSO_LINK_SESSION);
    const parsed = raw ? (JSON.parse(raw) as KeykeeperSsoLinkSession) : null;
    return parsed?.token && parsed?.identifier ? parsed : null;
  } catch {
    return null;
  }
}

function serverMessage(json: unknown): string | null {
  const body = json as { message?: string; ErrorModel?: { Message?: string } } | null;
  return body?.message || body?.ErrorModel?.Message || null;
}

/** An Error's message, or an ErrorResponse's (what ApiService throws). */
function errorMessage(e: unknown): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message !== ""
    ? message
    : "Something went wrong. Try again.";
}
