import { Injectable, OnDestroy } from "@angular/core";
import { firstValueFrom, Subscription } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { keykeeperListNewDeviceRequests } from "@bitwarden/common/auth/keykeeper/new-device-check";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { DialogService } from "@bitwarden/components";

import { KeykeeperNewDeviceApprovalDialogComponent } from "./new-device-approval-dialog.component";

/** How often an unlocked vault on screen asks for sign-ins waiting on it. */
export const KEYKEEPER_NEW_DEVICE_LIST_MS = 10_000;
/** How long Not now hides a prompt before it's shown again. */
export const KEYKEEPER_NEW_DEVICE_LATER_MS = 2 * 60_000;

/**
 * Keykeeper: prompts on this device for the account's sign-ins on new
 * devices (DESIGN.md, "New-device check"). While the vault is unlocked and on
 * screen, it asks the server every 10 seconds, and opens "Approve this
 * sign-in?" for each one waiting, one at a time. Started by the web vault's
 * InitService and the extension's popup.
 */
@Injectable({ providedIn: "root" })
export class KeykeeperNewDeviceApprovalsService implements OnDestroy {
  private status: Subscription | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  /** When each check was last shown, and Not now said. */
  private shown = new Map<string, number>();

  constructor(
    private apiService: ApiService,
    private authService: AuthService,
    private accountService: AccountService,
    private dialogService: DialogService,
    private logService: LogService,
  ) {}

  start() {
    if (this.status != null) {
      return;
    }
    this.status = this.authService.activeAccountStatus$.subscribe((status) => {
      if (status === AuthenticationStatus.Unlocked) {
        this.run();
      } else {
        this.halt();
      }
    });
  }

  ngOnDestroy() {
    this.status?.unsubscribe();
    this.status = null;
    this.halt();
  }

  private run() {
    if (this.timer != null) {
      return;
    }
    void this.check();
    this.timer = setInterval(() => void this.check(), KEYKEEPER_NEW_DEVICE_LIST_MS);
  }

  private halt() {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.shown.clear();
  }

  /** Asks once, and prompts for each new one. */
  async check() {
    if (this.busy || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
      return;
    }
    this.busy = true;
    try {
      const { requests, source } = await keykeeperListNewDeviceRequests(this.apiService);
      const account = await firstValueFrom(this.accountService.activeAccount$);
      for (const request of requests) {
        const last = this.shown.get(request.id);
        if (last != null && Date.now() - last < KEYKEEPER_NEW_DEVICE_LATER_MS) {
          continue;
        }
        this.shown.set(request.id, Date.now());
        const ref = KeykeeperNewDeviceApprovalDialogComponent.open(this.dialogService, {
          request,
          email: account?.email ?? "",
          source,
        });
        const result = await firstValueFrom(ref.closed);
        if (result === "later") {
          this.shown.set(request.id, Date.now());
        }
      }
    } catch (e) {
      // Offline, signed out meanwhile, or an older server: nothing to show.
      this.logService.debug("Keykeeper: couldn't list sign-ins on new devices", e);
    } finally {
      this.busy = false;
    }
  }
}
