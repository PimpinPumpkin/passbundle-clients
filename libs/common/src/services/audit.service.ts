import { Subject } from "rxjs";
import { mergeMap } from "rxjs/operators";

// eslint-disable-next-line no-restricted-imports
import { CryptoFunctionService } from "@bitwarden/legacy-crypto";

import { ApiService } from "../abstractions/api.service";
import { AuditService as AuditServiceAbstraction } from "../abstractions/audit.service";
import { PwnedPasswords, PwnedPasswordsCheckOptions } from "../dirt/keykeeper/pwned-passwords";
import { BreachAccountResponse } from "../dirt/models/response/breach-account.response";
import { HibpApiService } from "../dirt/services/hibp-api.service";

export class AuditService implements AuditServiceAbstraction {
  // Keykeeper: every check goes through one k-anonymity client, which limits
  // how many range requests run at once, keeps nothing afterward (no hash of
  // any password, the master password included), can be called off, and
  // fails (instead of answering 0) when the service can't be reached. See
  // libs/common/src/dirt/keykeeper/pwned-passwords.ts.
  private readonly pwnedPasswords: PwnedPasswords;

  private passwordLeakedSubject = new Subject<{
    password: string;
    options?: PwnedPasswordsCheckOptions;
    resolve: (count: number) => void;
    reject: (err: any) => void;
  }>();

  /**
   * @param maxConcurrent Ceiling on in-flight range lookups, shared by every caller of
   * {@link passwordLeaked} and {@link passwordLeakedStrict}.
   */
  constructor(
    private cryptoFunctionService: CryptoFunctionService,
    private apiService: ApiService,
    private hibpApiService: HibpApiService,
    private readonly maxConcurrent: number = 100,
  ) {
    this.pwnedPasswords = new PwnedPasswords(
      (text) => this.cryptoFunctionService.hash(text, "sha1"),
      (url, init) => this.apiService.nativeFetch(new Request(url, init)),
    );
    this.passwordLeakedSubject
      .pipe(
        mergeMap(
          // Handle each password leak request, resolving or rejecting the associated promise.
          async (req) => {
            try {
              const count = await this.fetchLeakedPasswordCount(req.password, req.options);
              req.resolve(count);
            } catch (err) {
              req.reject(err);
            }
          },
          this.maxConcurrent,
        ),
      )
      .subscribe();
  }

  async passwordLeaked(password: string, options?: PwnedPasswordsCheckOptions): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.passwordLeakedSubject.next({ password, options, resolve, reject });
    });
  }

  /**
   * Keykeeper: the same check: ours always fails rather than answering 0 when
   * the service can't be reached, and always asks for padding.
   */
  async passwordLeakedStrict(password: string): Promise<number> {
    return this.passwordLeaked(password);
  }

  /**
   * Fetches the count of leaked passwords from the Pwned Passwords API.
   * @param password The password to check.
   * @returns A promise that resolves to the number of times the password has been leaked.
   */
  protected async fetchLeakedPasswordCount(
    password: string,
    options?: PwnedPasswordsCheckOptions,
  ): Promise<number> {
    // Keykeeper: only the hash's first 5 characters are sent, with padding.
    return this.pwnedPasswords.timesExposed(password, options);
  }

  async breachedAccounts(username: string): Promise<BreachAccountResponse[]> {
    return this.hibpApiService.getHibpBreach(username);
  }
}
