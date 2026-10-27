import {
  ChangeDetectionStrategy,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from "@angular/core";
import { FormControl, FormGroup, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import {
  KEYKEEPER_TWO_STEP_SETUP,
  KeykeeperTwoStepSetupSession,
  keykeeperNamesPhrase,
  keykeeperTakeTwoStepHandoff,
} from "@bitwarden/auth/angular";
import { WebAuthnChallengeResponse } from "@bitwarden/common/auth/models/response/web-authn-challenge.response";
import { PasswordPreloginService } from "@bitwarden/common/auth/password-prelogin";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Fido2Utils } from "@bitwarden/common/platform/services/fido2/fido2-utils";
import { ToastService } from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";

import { SharedModule } from "../../shared";

/** What the server says about the setup session. */
type SetupInfo = {
  email: string;
  requiredBy: string[];
  hasMasterPassword: boolean;
  methods: { authenticator: boolean; webauthn: boolean; duo: boolean };
};

type Step = "loading" | "choose" | "authenticator" | "webauthn" | "duo" | "done" | "problem";

/** Upstream's QR code library, which the web vault serves (scripts/qrious.min.js). */
type QRiousConstructor = new (options: {
  element: HTMLElement | null;
  value: string;
  size: number;
}) => unknown;
const qrious = () => (window as unknown as { QRious?: QRiousConstructor }).QRious;

/**
 * Keykeeper: "Set up two-step login to continue". Someone whose role requires
 * two-step login (an organization's admins, an MSP's staff) and who hasn't set
 * up a method that counts gets a setup session from their sign-in instead of a
 * login. This page uses it, and nothing else does: an authenticator app, a
 * security key or passkey, or Duo, set up with upstream's own endpoints, which
 * still check the master password. The session ends when a method is set up;
 * the page shows the recovery code, and the person signs in as usual. See
 * DESIGN.md, "Two-step login for admins".
 */
@Component({
  selector: "app-keykeeper-two-step-setup",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SharedModule],
  template: `
    @switch (step()) {
      @case ("choose") {
        <div data-testid="two-step-setup-choose">
          <h2 bitTypography="h4">Set up two-step login to continue</h2>
          <p bitTypography="body1" data-testid="two-step-setup-why">
            @if (requiredBy()) {
              Two-step login is required for your role by {{ requiredBy() }}.
            } @else {
              Two-step login is required for your role.
            }
            Choose how you'll confirm it's you each time you sign in. Email codes don't count here.
          </p>
          @if (!haveHash()) {
            <bit-form-field>
              <bit-label>Master password</bit-label>
              <input
                bitInput
                type="password"
                [formControl]="masterPassword"
                autocomplete="current-password"
                data-testid="two-step-setup-password"
              />
              <bit-hint
                >To confirm it's you, as when you change two-step login in Settings.</bit-hint
              >
            </bit-form-field>
          }
          <div class="tw-flex tw-flex-col tw-gap-2">
            @if (info()?.methods?.authenticator) {
              <button
                bitButton
                buttonType="primary"
                type="button"
                [block]="true"
                [loading]="busy()"
                (click)="startAuthenticator()"
                data-testid="two-step-setup-authenticator"
              >
                Use an authenticator app
              </button>
            }
            @if (info()?.methods?.webauthn) {
              <button
                bitButton
                buttonType="secondary"
                type="button"
                [block]="true"
                [disabled]="busy()"
                (click)="startWebAuthn()"
              >
                Use a security key or passkey
              </button>
            }
            @if (info()?.methods?.duo) {
              <button
                bitButton
                buttonType="secondary"
                type="button"
                [block]="true"
                [disabled]="busy()"
                (click)="startDuo()"
              >
                Use Duo
              </button>
            }
            <button bitButton buttonType="secondary" type="button" [block]="true" (click)="leave()">
              Back to sign in
            </button>
          </div>
        </div>
      }
      @case ("authenticator") {
        <form
          [formGroup]="authenticatorForm"
          [bitSubmit]="turnOnAuthenticator"
          data-testid="two-step-setup-authenticator-step"
        >
          <p bitTypography="body1">
            Scan this code with your authenticator app, or enter the key by hand. Then enter the
            six-digit code it shows.
          </p>
          <div class="tw-mb-4 tw-flex tw-justify-center">
            <canvas id="keykeeper-two-step-qr"></canvas>
          </div>
          <p bitTypography="body2">
            Key:
            <code class="tw-break-all" data-testid="two-step-setup-key">{{ key() }}</code>
          </p>
          <bit-form-field>
            <bit-label>Verification code</bit-label>
            <input
              bitInput
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              formControlName="code"
              data-testid="two-step-setup-code"
            />
          </bit-form-field>
          <div class="tw-flex tw-gap-2">
            <button bitButton bitFormButton buttonType="primary" type="submit">Turn on</button>
            <button bitButton buttonType="secondary" type="button" (click)="back()">Back</button>
          </div>
        </form>
      }
      @case ("webauthn") {
        <form [formGroup]="webAuthnForm" [bitSubmit]="turnOnWebAuthn">
          <p bitTypography="body1">
            Name your security key or passkey, then use it when your browser asks.
          </p>
          <bit-form-field>
            <bit-label>Name</bit-label>
            <input bitInput type="text" formControlName="name" />
          </bit-form-field>
          <div class="tw-flex tw-gap-2">
            <button bitButton bitFormButton buttonType="primary" type="submit">
              Use my security key or passkey
            </button>
            <button bitButton buttonType="secondary" type="button" (click)="back()">Back</button>
          </div>
        </form>
      }
      @case ("duo") {
        <form [formGroup]="duoForm" [bitSubmit]="turnOnDuo">
          <p bitTypography="body1">
            Enter your Duo application's details from the Duo Admin Panel.
          </p>
          <bit-form-field>
            <bit-label>Client ID</bit-label>
            <input bitInput type="text" formControlName="clientId" />
          </bit-form-field>
          <bit-form-field>
            <bit-label>Client secret</bit-label>
            <input bitInput type="password" formControlName="clientSecret" />
          </bit-form-field>
          <bit-form-field>
            <bit-label>API hostname</bit-label>
            <input bitInput type="text" formControlName="host" />
          </bit-form-field>
          <div class="tw-flex tw-gap-2">
            <button bitButton bitFormButton buttonType="primary" type="submit">Turn on</button>
            <button bitButton buttonType="secondary" type="button" (click)="back()">Back</button>
          </div>
        </form>
      }
      @case ("done") {
        <div data-testid="two-step-setup-done">
          <h2 bitTypography="h4">Two-step login is on</h2>
          <p bitTypography="body1">
            Save your recovery code somewhere safe, away from this device. If you lose your
            authenticator, security key, or Duo, it's the only way back into your account without
            them.
          </p>
          @if (recoveryCode(); as rc) {
            <p class="tw-text-center tw-font-mono tw-text-lg" data-testid="two-step-setup-recovery">
              {{ rc }}
            </p>
            <button bitButton buttonType="secondary" type="button" (click)="copyRecoveryCode()">
              Copy recovery code
            </button>
          }
          <p bitTypography="body1" class="tw-mt-4">Now sign in again, with your new second step.</p>
          <button
            bitButton
            buttonType="primary"
            type="button"
            [block]="true"
            (click)="leave()"
            data-testid="two-step-setup-continue"
          >
            Continue to sign in
          </button>
        </div>
      }
      @case ("problem") {
        <div data-testid="two-step-setup-problem">
          <p bitTypography="body1">{{ problem() }}</p>
          <button bitButton buttonType="secondary" type="button" (click)="leave()">
            Back to sign in
          </button>
        </div>
      }
      @default {
        <p bitTypography="body2">Loading…</p>
      }
    }
  `,
})
export class KeykeeperTwoStepSetupComponent implements OnInit, OnDestroy {
  protected readonly step = signal<Step>("loading");
  protected readonly info = signal<SetupInfo | null>(null);
  protected readonly requiredBy = signal("");
  protected readonly problem = signal("");
  protected readonly busy = signal(false);
  protected readonly key = signal("");
  protected readonly recoveryCode = signal<string | null>(null);

  protected readonly masterPassword = new FormControl("", { nonNullable: true });
  protected readonly authenticatorForm = new FormGroup({
    code: new FormControl("", { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly webAuthnForm = new FormGroup({
    name: new FormControl("Security key", { nonNullable: true }),
  });
  protected readonly duoForm = new FormGroup({
    clientId: new FormControl("", { nonNullable: true, validators: [Validators.required] }),
    clientSecret: new FormControl("", { nonNullable: true, validators: [Validators.required] }),
    host: new FormControl("", { nonNullable: true, validators: [Validators.required] }),
  });

  /** The setup session, the master password's server hash (in memory only), and the QR script. */
  private readonly held: {
    session: KeykeeperTwoStepSetupSession | null;
    masterPasswordHash: string | null;
    qrScript: HTMLScriptElement | null;
  } = { session: null, masterPasswordHash: null, qrScript: null };
  /** Whether the page already has the master password's server hash. */
  protected readonly haveHash = signal(false);

  constructor(
    private readonly router: Router,
    private readonly environmentService: EnvironmentService,
    private readonly passwordPreloginService: PasswordPreloginService,
    private readonly keyService: KeyService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly toastService: ToastService,
    private readonly ngZone: NgZone,
  ) {}

  async ngOnInit() {
    const session = readSession();
    this.held.session = session;
    if (session == null) {
      this.fail("This setup session expired. Sign in again.");
      return;
    }
    this.held.masterPasswordHash =
      keykeeperTakeTwoStepHandoff(session.token)?.masterPasswordHash ?? null;
    this.haveHash.set(this.held.masterPasswordHash != null);
    try {
      const info = (await this.call("GET", "/keykeeper/two-step-setup")) as SetupInfo;
      this.info.set(info);
      this.requiredBy.set(keykeeperNamesPhrase(info.requiredBy ?? session.requiredBy));
      this.step.set("choose");
    } catch (e) {
      this.fail(errorMessage(e));
    }
  }

  ngOnDestroy() {
    this.held.qrScript?.remove();
  }

  /** The master password's server hash: from the sign-in, or typed here. */
  private async passwordHash(): Promise<string> {
    if (this.held.masterPasswordHash) {
      return this.held.masterPasswordHash;
    }
    const password = this.masterPassword.value;
    const email = this.info()?.email;
    if (!password || !email) {
      throw new Error("Enter your master password.");
    }
    const prelogin = await firstValueFrom(this.passwordPreloginService.getPreloginData$(email));
    this.passwordPreloginService.clearCache();
    const masterKey = await this.keyService.makeMasterKey(password, email, prelogin.kdfConfig);
    const hash = await this.keyService.hashMasterKey(password, masterKey);
    this.held.masterPasswordHash = hash;
    this.haveHash.set(true);
    this.masterPassword.setValue("");
    return hash;
  }

  protected async startAuthenticator() {
    await this.attempt(async () => {
      const answer = (await this.call("POST", "/two-factor/get-authenticator", {
        masterPasswordHash: await this.passwordHash(),
      })) as { key: string };
      this.key.set(answer.key);
      this.authenticatorForm.controls.code.setValue("");
      this.step.set("authenticator");
      await this.drawQrCode(answer.key);
    });
  }

  protected readonly turnOnAuthenticator = async () => {
    await this.attempt(async () => {
      const answer = (await this.call("PUT", "/two-factor/authenticator", {
        key: this.key(),
        token: this.authenticatorForm.controls.code.value.replace(/\s/g, ""),
        masterPasswordHash: await this.passwordHash(),
      })) as { keykeeperRecoveryCode?: string };
      this.finish(answer);
    });
  };

  protected startWebAuthn() {
    this.step.set("webauthn");
  }

  protected readonly turnOnWebAuthn = async () => {
    await this.attempt(async () => {
      const masterPasswordHash = await this.passwordHash();
      const existing = (await this.call("POST", "/two-factor/get-webauthn", {
        masterPasswordHash,
      })) as { keys?: { id: number }[] };
      const used = new Set((existing.keys ?? []).map((k) => k.id));
      const id = [1, 2, 3, 4, 5].find((n) => !used.has(n));
      if (id == null) {
        throw new Error("This account already has five security keys.");
      }
      const challenge = new WebAuthnChallengeResponse(
        await this.call("POST", "/two-factor/get-webauthn-challenge", { masterPasswordHash }),
      );
      const credential = (await navigator.credentials.create({
        publicKey: challenge,
      })) as PublicKeyCredential | null;
      if (credential == null) {
        throw new Error("Your browser didn't return a security key. Try again.");
      }
      const response = credential.response as AuthenticatorAttestationResponse;
      const answer = (await this.call("PUT", "/two-factor/webauthn", {
        id,
        name: this.webAuthnForm.controls.name.value || "Security key",
        masterPasswordHash,
        deviceResponse: {
          id: credential.id,
          rawId: Fido2Utils.arrayToString(Fido2Utils.bufferSourceToUint8Array(credential.rawId)),
          type: credential.type,
          extensions: credential.getClientExtensionResults(),
          response: {
            AttestationObject: Fido2Utils.arrayToString(
              Fido2Utils.bufferSourceToUint8Array(response.attestationObject),
            ),
            clientDataJson: Fido2Utils.arrayToString(
              Fido2Utils.bufferSourceToUint8Array(response.clientDataJSON),
            ),
            transports: response.getTransports(),
          },
        },
      })) as { keykeeperRecoveryCode?: string };
      this.finish(answer);
    });
  };

  protected startDuo() {
    this.step.set("duo");
  }

  protected readonly turnOnDuo = async () => {
    await this.attempt(async () => {
      const answer = (await this.call("PUT", "/two-factor/duo", {
        clientId: this.duoForm.controls.clientId.value.trim(),
        clientSecret: this.duoForm.controls.clientSecret.value.trim(),
        host: this.duoForm.controls.host.value.trim(),
        masterPasswordHash: await this.passwordHash(),
      })) as { keykeeperRecoveryCode?: string };
      this.finish(answer);
    });
  };

  protected back() {
    this.step.set("choose");
  }

  protected copyRecoveryCode() {
    const code = this.recoveryCode();
    if (code) {
      this.platformUtilsService.copyToClipboard(code);
      this.toastService.showToast({ variant: "success", message: "Copied" });
    }
  }

  /** Set up: the session ended with it. */
  private finish(answer: { keykeeperRecoveryCode?: string }) {
    sessionStorage.removeItem(KEYKEEPER_TWO_STEP_SETUP);
    this.held.session = null;
    this.held.masterPasswordHash = null;
    this.recoveryCode.set(answer.keykeeperRecoveryCode ?? null);
    this.step.set("done");
  }

  protected async leave() {
    sessionStorage.removeItem(KEYKEEPER_TWO_STEP_SETUP);
    this.held.masterPasswordHash = null;
    const email = this.info()?.email;
    await this.router.navigate(["/login"], email ? { queryParams: { email } } : {});
  }

  private fail(message: string) {
    this.problem.set(message);
    this.step.set("problem");
  }

  private async attempt(action: () => Promise<void>) {
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      if (e instanceof SessionEnded) {
        this.fail(e.message);
      } else {
        this.toastService.showToast({ variant: "error", message: errorMessage(e) });
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Draws the authenticator's QR code with upstream's QRious, if it loads. */
  private async drawQrCode(key: string) {
    if (qrious() == null) {
      await new Promise<void>((resolve) => {
        const script = document.createElement("script");
        script.src = "scripts/qrious.min.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => resolve();
        this.held.qrScript = script;
        document.body.appendChild(script);
      });
    }
    const email = this.info()?.email ?? "";
    const env = await firstValueFrom(this.environmentService.environment$);
    // The issuer is the web vault's own host, which every authenticator shows.
    const issuer = new URL(env.getWebVaultUrl()).host;
    this.ngZone.runOutsideAngular(() => {
      setTimeout(() => {
        const QRious = qrious();
        if (QRious == null) {
          return;
        }
        new QRious({
          element: document.getElementById("keykeeper-two-step-qr"),
          value:
            `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}` +
            `?secret=${encodeURIComponent(key)}&issuer=${encodeURIComponent(issuer)}`,
          size: 160,
        });
      });
    });
  }

  /**
   * A setup request, with the setup session's token: it isn't a login, so
   * only the two-step setup requests take it.
   */
  private async call(method: "GET" | "POST" | "PUT", path: string, body?: unknown) {
    const session = this.held.session;
    if (session == null) {
      throw new SessionEnded("This setup session expired. Sign in again.");
    }
    const env = await firstValueFrom(this.environmentService.environment$);
    const response = await fetch(env.getApiUrl() + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch((): unknown => null);
    if (response.status === 401) {
      sessionStorage.removeItem(KEYKEEPER_TWO_STEP_SETUP);
      throw new SessionEnded("This setup session expired. Sign in again.");
    }
    if (!response.ok) {
      throw new Error(serverMessage(json) ?? "Something went wrong. Try again.");
    }
    return json;
  }
}

class SessionEnded extends Error {}

function readSession(): KeykeeperTwoStepSetupSession | null {
  try {
    const raw = sessionStorage.getItem(KEYKEEPER_TWO_STEP_SETUP);
    const parsed = raw ? (JSON.parse(raw) as KeykeeperTwoStepSetupSession) : null;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

function serverMessage(json: unknown): string | null {
  const body = json as { message?: string; ErrorModel?: { Message?: string } } | null;
  return body?.message || body?.ErrorModel?.Message || null;
}

function errorMessage(e: unknown): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === "string" && message !== ""
    ? message
    : "Something went wrong. Try again.";
}
