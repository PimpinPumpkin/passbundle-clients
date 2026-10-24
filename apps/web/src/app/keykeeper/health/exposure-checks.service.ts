import { Injectable } from "@angular/core";
import { distinctUntilChanged, of, switchMap } from "rxjs";

import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import {
  checkPasswords,
  PwnedPasswordsCheckOptions,
} from "@bitwarden/common/dirt/keykeeper/pwned-passwords";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

export type ExposureCheckOptions = PwnedPasswordsCheckOptions & {
  progress?: (checked: number, total: number) => void;
};

/** An item's version: its id and when it last changed. A changed password is a new version. */
function versionOf(cipher: CipherView): string | null {
  return cipher.id == null ? null : `${cipher.id}:${cipher.revisionDate?.getTime() ?? ""}`;
}

/**
 * Keykeeper: the web vault's breach checks of vault items, for the count
 * beside Health and the MSP console. What a check found is remembered by item
 * version (id and revision date), never by password or hash, so the console
 * reloading after an action doesn't ask again, and an edited item is asked
 * about anew. Failures are never remembered. It's all forgotten when the
 * vault locks or the account signs out. See DESIGN.md, "Exposed passwords".
 */
@Injectable({ providedIn: "root" })
export class KeykeeperExposureChecks {
  /** Times seen, by item version. */
  private readonly byVersion = new Map<string, number>();

  constructor(
    private readonly auditService: AuditService,
    accountService: AccountService,
    authService: AuthService,
  ) {
    accountService.activeAccount$
      .pipe(
        switchMap((account) =>
          account == null
            ? of(AuthenticationStatus.LoggedOut)
            : authService.authStatusFor$(account.id),
        ),
        distinctUntilChanged(),
      )
      .subscribe((status) => {
        if (status !== AuthenticationStatus.Unlocked) {
          this.forget();
        }
      });
  }

  forget(): void {
    this.byVersion.clear();
  }

  /**
   * What the breach check finds for these items' passwords, by password, for
   * this run only: what's known by item version, and the rest asked (each
   * different password once, in random order). Throws
   * PwnedPasswordsCancelledError when the run is called off.
   */
  async check(
    ciphers: CipherView[],
    options: ExposureCheckOptions = {},
  ): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    const unknown: CipherView[] = [];
    for (const cipher of ciphers) {
      const version = versionOf(cipher);
      const known = version == null ? undefined : this.byVersion.get(version);
      if (known === undefined) {
        unknown.push(cipher);
      } else {
        results.set(cipher.login.password, known);
      }
    }
    const fresh = await checkPasswords(
      unknown.map((cipher) => cipher.login.password).filter((password) => !results.has(password)),
      (password, check) => this.auditService.passwordLeaked(password, check),
      options.progress,
      { signal: options.signal, mayAsk: options.mayAsk },
    );
    for (const [password, times] of fresh) {
      results.set(password, times);
    }
    for (const cipher of unknown) {
      const version = versionOf(cipher);
      const times = results.get(cipher.login.password);
      if (version != null && times != null) {
        this.byVersion.set(version, times);
      }
    }
    return results;
  }
}
