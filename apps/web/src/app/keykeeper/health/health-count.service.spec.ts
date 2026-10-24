import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom, toArray } from "rxjs";

import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { PwnedPasswordsCheckOptions } from "@bitwarden/common/dirt/keykeeper/pwned-passwords";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { KeykeeperBreachCheckSetting } from "./breach-check-setting.service";
import { KeykeeperExposureChecks } from "./exposure-checks.service";
import {
  HEALTH_COUNT_SETTLE_MS,
  HEALTH_COUNT_START_MS,
  KeykeeperHealthCountService,
} from "./health-count.service";

const USER_ID = "user-1" as UserId;

let nextId = 0;
function login(password: string, { edit = true, org = null as string | null } = {}): CipherView {
  const cipher = new CipherView();
  cipher.id = `item-${nextId++}`;
  cipher.type = CipherType.Login;
  cipher.organizationId = org as string;
  cipher.edit = edit;
  cipher.login = new LoginView();
  cipher.login.password = password;
  return cipher;
}

describe("Health's count of items to fix", () => {
  let status$: BehaviorSubject<AuthenticationStatus>;
  let ciphers$: BehaviorSubject<CipherView[] | null>;
  let checkAfterUnlock$: BehaviorSubject<boolean>;
  let auditService: ReturnType<typeof mock<AuditService>>;
  let service: KeykeeperHealthCountService;

  beforeEach(() => {
    status$ = new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Locked);
    ciphers$ = new BehaviorSubject<CipherView[] | null>(null);
    checkAfterUnlock$ = new BehaviorSubject<boolean>(true);
    const breachCheck = mock<KeykeeperBreachCheckSetting>();
    breachCheck.checksAfterUnlock$.mockReturnValue(checkAfterUnlock$);
    const authService = mock<AuthService>();
    authService.authStatusFor$.mockReturnValue(status$);
    const cipherService = mock<CipherService>();
    cipherService.cipherViews$.mockReturnValue(ciphers$);
    // Scores by length, so tests don't depend on the strength library.
    const strength = mock<PasswordStrengthServiceAbstraction>();
    strength.getPasswordStrength.mockImplementation(
      (password: string) => ({ score: password.length >= 12 ? 4 : 1 }) as never,
    );
    auditService = mock<AuditService>();
    auditService.passwordLeaked.mockImplementation(async (password) =>
      password === "long-but-in-a-breach" ? 51 : 0,
    );
    const accountService = mockAccountServiceWith(USER_ID);
    service = new KeykeeperHealthCountService(
      accountService,
      authService,
      cipherService,
      strength,
      new KeykeeperExposureChecks(auditService, accountService, authService),
      breachCheck,
    );
  });

  const vault = () => [
    login("short1"),
    login("a-long-shared-passphrase"),
    login("a-long-shared-passphrase"),
    login("long-but-in-a-breach"),
    login("long-unique-and-unseen"),
    // Not the person's to edit, so their Health doesn't list it, as upstream's reports.
    login("short2", { edit: false, org: "org-1" }),
  ];

  it("counts weak and reused first, then adds exposed, each item once", async () => {
    const counts = await firstValueFrom(service.count(vault()).pipe(toArray()));
    expect(counts).toEqual([
      { toFix: 3, couldntCheck: false },
      { toFix: 4, couldntCheck: false },
    ]);
  });

  it("says it couldn't check when the breach check can't be made, keeping weak and reused", async () => {
    auditService.passwordLeaked.mockRejectedValue(new Error("Failed to fetch"));
    const counts = await firstValueFrom(service.count(vault()).pipe(toArray()));
    expect(counts).toEqual([
      { toFix: 3, couldntCheck: false },
      { toFix: 3, couldntCheck: true },
    ]);
  });

  it("counts weak and reused only, and asks nothing, when the person turned the check off", async () => {
    const counts = await firstValueFrom(
      service.count(vault(), { checkExposed: false }).pipe(toArray()),
    );
    expect(counts).toEqual([{ toFix: 3, couldntCheck: false }]);
    expect(auditService.passwordLeaked).not.toHaveBeenCalled();
  });

  it("asks the breach check about each different password once", async () => {
    await firstValueFrom(service.count(vault()).pipe(toArray()));
    expect(auditService.passwordLeaked.mock.calls.map(([p]) => p).sort()).toEqual([
      "a-long-shared-passphrase",
      "long-but-in-a-breach",
      "long-unique-and-unseen",
      "short1",
    ]);
  });

  it("calls off the checks still waiting when it's no longer wanted", async () => {
    const asked: PwnedPasswordsCheckOptions[] = [];
    auditService.passwordLeaked.mockImplementation(
      (_password, options) =>
        new Promise((_resolve, reject) => {
          asked.push(options!);
          options!.signal!.addEventListener("abort", () => reject(new Error("called off")));
        }),
    );
    const subscription = service.count(vault()).subscribe();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked).toHaveLength(4);
    expect(asked.some((o) => o.signal!.aborted)).toBe(false);

    subscription.unsubscribe();
    expect(asked.every((o) => o.signal!.aborted)).toBe(true);
  });

  it("waits until the vault is unlocked and has shown, reads the setting before each request, and counts nothing while locked", async () => {
    jest.useFakeTimers();
    try {
      const asked: PwnedPasswordsCheckOptions[] = [];
      auditService.passwordLeaked.mockImplementation(async (password, options) => {
        asked.push(options!);
        return password === "long-but-in-a-breach" ? 51 : 0;
      });
      const seen: (number | undefined)[] = [];
      const subscription = service.count$.subscribe((count) => seen.push(count?.toFix));
      ciphers$.next(vault());
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_START_MS + HEALTH_COUNT_SETTLE_MS + 100);
      expect(seen).toEqual([undefined]);
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();

      status$.next(AuthenticationStatus.Unlocked);
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_START_MS - 100);
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_SETTLE_MS + 1_000);
      expect(seen).toEqual([undefined, 3, 4]);
      // Each request reads the setting just before it goes out.
      expect(await asked[0].mayAsk!()).toBe(true);

      // Turned off: counted again without asking, and a request still queued
      // from before would now be called off.
      auditService.passwordLeaked.mockClear();
      checkAfterUnlock$.next(false);
      expect(await asked[0].mayAsk!()).toBe(false);
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_SETTLE_MS + 1_000);
      expect(seen.at(-1)).toBe(3);
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();
      // Turned back on: the items' results are remembered by version, so
      // nothing is asked again.
      checkAfterUnlock$.next(true);
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_SETTLE_MS + 1_000);
      expect(seen.at(-1)).toBe(4);
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();

      status$.next(AuthenticationStatus.Locked);
      await jest.advanceTimersByTimeAsync(0);
      expect(seen.at(-1)).toBeUndefined();
      subscription.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });
});
