import { mock } from "jest-mock-extended";
import { BehaviorSubject, firstValueFrom, toArray } from "rxjs";

import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { PasswordStrengthServiceAbstraction } from "@bitwarden/common/tools/password-strength";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

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
  let auditService: ReturnType<typeof mock<AuditService>>;
  let service: KeykeeperHealthCountService;

  beforeEach(() => {
    status$ = new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Locked);
    ciphers$ = new BehaviorSubject<CipherView[] | null>(null);
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
    service = new KeykeeperHealthCountService(
      mockAccountServiceWith(USER_ID),
      authService,
      cipherService,
      strength,
      auditService,
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
    expect(counts).toEqual([3, 4]);
  });

  it("counts weak and reused only when the breach check can't be made", async () => {
    auditService.passwordLeaked.mockRejectedValue(new Error("Failed to fetch"));
    const counts = await firstValueFrom(service.count(vault()).pipe(toArray()));
    expect(counts).toEqual([3, 3]);
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

  it("waits until the vault is unlocked and has shown, and counts nothing while locked", async () => {
    jest.useFakeTimers();
    try {
      const seen: (number | undefined)[] = [];
      const subscription = service.count$.subscribe((count) => seen.push(count));
      ciphers$.next(vault());
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_START_MS + HEALTH_COUNT_SETTLE_MS + 100);
      expect(seen).toEqual([undefined]);
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();

      status$.next(AuthenticationStatus.Unlocked);
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_START_MS - 100);
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(HEALTH_COUNT_SETTLE_MS + 1_000);
      expect(seen).toEqual([undefined, 3, 4]);

      status$.next(AuthenticationStatus.Locked);
      await jest.advanceTimersByTimeAsync(0);
      expect(seen.at(-1)).toBeUndefined();
      subscription.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });
});
