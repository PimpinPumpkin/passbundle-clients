import { CommonModule } from "@angular/common";
import { Component, inject, OnDestroy, OnInit } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom, Subject, takeUntil } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import {
  LoginStrategySessionTimeoutService,
  LoginSuccessHandlerService,
} from "@bitwarden/auth/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import {
  KeykeeperNewDeviceCheck,
  keykeeperNewDeviceCheckEmail,
  keykeeperNewDeviceCheckStatus,
  keykeeperTakeNewDeviceCheck,
} from "@bitwarden/common/auth/keykeeper/new-device-check";
import { AuthResult } from "@bitwarden/common/auth/models/domain/auth-result";
import { ForceSetPasswordReason } from "@bitwarden/common/auth/models/domain/force-set-password-reason";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { MasterPasswordServiceAbstraction } from "@bitwarden/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { plainErrorMessage } from "@bitwarden/common/platform/keykeeper/plain-errors";
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import {
  AsyncActionsModule,
  ButtonModule,
  CalloutModule,
  DialogService,
  FormFieldModule,
  LinkModule,
  ToastService,
  TypographyModule,
} from "@bitwarden/components";

import { LoginStrategyServiceAbstraction } from "../../common/abstractions/login-strategy.service";
import { keykeeperStartSsoLink } from "../sso/keykeeper-sso-link";
import { keykeeperStartTwoStepSetup } from "../two-step/keykeeper-two-step-setup";

/** How often the page asks whether the sign-in was approved. */
export const KEYKEEPER_NEW_DEVICE_POLL_MS = 3000;

/**
 * Keykeeper: the new-device check's waiting page (DESIGN.md, "New-device
 * check"), in place of upstream's new device verification page. An account
 * without two-step login signed in on a device it has never used: this page
 * shows the number to type on a device already signed in, asks every few
 * seconds until that's done, and then finishes the sign-in. When no device
 * can approve, it offers a code by email; when the person can't reach their
 * devices, a code by email after a day's wait.
 */
// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "auth-keykeeper-new-device-check",
  templateUrl: "./keykeeper-new-device-check.component.html",
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AsyncActionsModule,
    JslibModule,
    ButtonModule,
    CalloutModule,
    FormFieldModule,
    LinkModule,
    TypographyModule,
  ],
})
export class KeykeeperNewDeviceCheckComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly apiService = inject(ApiService);
  private readonly loginStrategyService = inject(LoginStrategyServiceAbstraction);
  private readonly loginSuccessHandlerService = inject(LoginSuccessHandlerService);
  private readonly sessionTimeout = inject(LoginStrategySessionTimeoutService);
  private readonly accountService = inject(AccountService);
  private readonly masterPasswordService = inject(MasterPasswordServiceAbstraction);
  private readonly i18nService = inject(I18nService);
  private readonly logService = inject(LogService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly platformUtilsService = inject(PlatformUtilsService);
  private readonly environmentService = inject(EnvironmentService);

  protected check: KeykeeperNewDeviceCheck | null = null;
  /** "loading", "waiting", "denied", "ended", or "finishing". */
  protected phase: "loading" | "waiting" | "denied" | "ended" | "finishing" = "loading";
  protected showCantReach = false;
  protected error: string | null = null;

  protected codeForm = inject(FormBuilder).group({
    code: ["", { validators: [Validators.required], updateOn: "change" }],
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private keptAliveAt = 0;
  private destroy$ = new Subject<void>();

  async ngOnInit() {
    this.sessionTimeout.loginSessionTimeout$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.stop();
      this.phase = "ended";
    });
    this.check = keykeeperTakeNewDeviceCheck();
    if (this.check == null) {
      // A reload, or the extension's popup opened again: signing in again
      // from this device finds the same check, with a new token.
      await this.resend();
    } else {
      this.show(this.check);
    }
  }

  ngOnDestroy() {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** The sign-in's request again, without a token: the check as it stands. */
  private async resend() {
    try {
      const result = await this.loginStrategyService.logInNewDeviceVerification("");
      await this.after(result);
    } catch (e) {
      this.logService.error(e);
      this.phase = "ended";
    }
  }

  private show(check: KeykeeperNewDeviceCheck) {
    this.check = check;
    if (check.status === "denied") {
      this.stop();
      this.phase = "denied";
      return;
    }
    this.phase = "waiting";
    void this.keepAlive();
    if (check.status === "approved") {
      void this.finish(check.token);
      return;
    }
    this.schedule();
  }

  private schedule() {
    this.stop();
    this.timer = setTimeout(() => void this.poll(), KEYKEEPER_NEW_DEVICE_POLL_MS);
  }

  private stop() {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * The sign-in's details stay in memory while the check waits (upstream
   * keeps them 5 minutes; a check lasts 10), so finishing doesn't ask for the
   * master password again.
   */
  private async keepAlive() {
    if (Date.now() - this.keptAliveAt < 60_000) {
      return;
    }
    this.keptAliveAt = Date.now();
    try {
      await this.sessionTimeout.startSessionTimeout();
    } catch (e) {
      this.logService.error(e);
    }
  }

  private async poll() {
    const check = this.check;
    if (check == null || this.phase !== "waiting") {
      return;
    }
    try {
      const now = await keykeeperNewDeviceCheckStatus(this.apiService, check);
      if (now == null) {
        this.phase = "ended";
        return;
      }
      this.show({ ...now, token: check.token });
    } catch (e) {
      if (e instanceof ErrorResponse && e.statusCode === 404) {
        this.phase = "ended";
        return;
      }
      // Offline for a moment: keep asking.
      this.schedule();
    }
  }

  /** "Email me a code", or a code after the wait when devices can't be reached. */
  protected sendEmail = async () => {
    const check = this.check;
    if (check == null) {
      return;
    }
    this.error = null;
    try {
      const now = await keykeeperNewDeviceCheckEmail(this.apiService, check);
      if (now != null) {
        this.check = { ...now, token: check.token };
        this.showCantReach = false;
      }
    } catch (e) {
      this.error = plainErrorMessage(e);
    }
  };

  protected submitCode = async () => {
    const code = (this.codeForm.value.code ?? "").replace(/\s/g, "");
    if (!code) {
      return;
    }
    await this.finish(code);
  };

  private async finish(otp: string) {
    this.stop();
    this.phase = "finishing";
    this.error = null;
    try {
      const result = await this.loginStrategyService.logInNewDeviceVerification(otp);
      await this.after(result);
    } catch (e) {
      this.logService.error(e);
      this.error = plainErrorMessage(e);
      this.phase = "waiting";
      if (this.check?.status !== "approved") {
        this.schedule();
      }
    }
  }

  /** What the server answered: still waiting, or signed in. */
  private async after(result: AuthResult) {
    if (result.requiresDeviceVerification) {
      const check = result.keykeeperNewDeviceCheck ?? keykeeperTakeNewDeviceCheck();
      keykeeperTakeNewDeviceCheck();
      if (check == null) {
        this.phase = "ended";
        return;
      }
      this.show(check);
      return;
    }
    this.stop();
    if (result.requiresTwoFactor) {
      await this.router.navigate(["/2fa"]);
      return;
    }
    const clientType = this.platformUtilsService.getClientType();
    if (
      await keykeeperStartSsoLink(result, {
        router: this.router,
        toastService: this.toastService,
        i18nService: this.i18nService,
        clientType,
      })
    ) {
      return;
    }
    if (
      await keykeeperStartTwoStepSetup(result, {
        router: this.router,
        i18nService: this.i18nService,
        dialogService: this.dialogService,
        platformUtilsService: this.platformUtilsService,
        clientType,
        webVaultUrl: async () =>
          (await firstValueFrom(this.environmentService.environment$)).getWebVaultUrl(),
      })
    ) {
      return;
    }
    await this.loginSuccessHandlerService.run(result.userId, result.masterPassword);
    const activeUserId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const reason = await firstValueFrom(
      this.masterPasswordService.forceSetPasswordReason$(activeUserId),
    );
    if (
      reason === ForceSetPasswordReason.WeakMasterPassword ||
      reason === ForceSetPasswordReason.AdminForcePasswordReset
    ) {
      await this.router.navigate(["/change-password"]);
    } else {
      await this.router.navigate(["/vault"]);
    }
  }

  protected startOver = async () => {
    this.stop();
    await this.router.navigate(["/login"]);
  };

  protected minutesLeft(): number {
    const ends = Date.parse(this.check?.expiresAt ?? "");
    return Number.isNaN(ends) ? 0 : Math.max(0, Math.ceil((ends - Date.now()) / 60_000));
  }

  protected emailAfterText(): string {
    const at = Date.parse(this.check?.emailAfter ?? "");
    return Number.isNaN(at) ? "" : new Date(at).toLocaleString();
  }
}
