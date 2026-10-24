import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { PwnedPasswordsCancelledError } from "@bitwarden/common/dirt/keykeeper/pwned-passwords";
import { mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { KeykeeperExposureChecks } from "./exposure-checks.service";

function login(id: string, password: string, revised = new Date(2026, 9, 1)): CipherView {
  const cipher = new CipherView();
  cipher.id = id;
  cipher.type = CipherType.Login;
  cipher.revisionDate = revised;
  cipher.login = new LoginView();
  cipher.login.password = password;
  return cipher;
}

describe("the web vault's breach checks of items", () => {
  let status$: BehaviorSubject<AuthenticationStatus>;
  let auditService: ReturnType<typeof mock<AuditService>>;
  let checks: KeykeeperExposureChecks;

  beforeEach(() => {
    status$ = new BehaviorSubject<AuthenticationStatus>(AuthenticationStatus.Unlocked);
    const authService = mock<AuthService>();
    authService.authStatusFor$.mockReturnValue(status$);
    auditService = mock<AuditService>();
    auditService.passwordLeaked.mockImplementation(async (password) =>
      password === "breached" ? 7 : 0,
    );
    checks = new KeykeeperExposureChecks(
      auditService,
      mockAccountServiceWith("user-1" as UserId),
      authService,
    );
  });

  it("answers by password, asking each different password once", async () => {
    const results = await checks.check([
      login("a", "breached"),
      login("b", "breached"),
      login("c", "fine"),
    ]);
    expect(results).toEqual(
      new Map([
        ["breached", 7],
        ["fine", 0],
      ]),
    );
    expect(auditService.passwordLeaked).toHaveBeenCalledTimes(2);
  });

  it("remembers what it found by item version, never by password, and asks again for an edited item", async () => {
    await checks.check([login("a", "breached")]);
    await checks.check([login("a", "breached")]);
    expect(auditService.passwordLeaked).toHaveBeenCalledTimes(1);

    // Edited: a new revision is a new version.
    await checks.check([login("a", "fine", new Date(2026, 9, 2))]);
    expect(auditService.passwordLeaked).toHaveBeenCalledTimes(2);
    // Nothing in the memory is a password or a hash.
    const kept = [...(checks as unknown as { byVersion: Map<string, number> }).byVersion.keys()];
    expect(kept.every((key) => key.startsWith("a:"))).toBe(true);
  });

  it("never remembers a failed check", async () => {
    auditService.passwordLeaked.mockRejectedValueOnce(new Error("Failed to fetch"));
    expect((await checks.check([login("a", "breached")])).get("breached")).toBeNull();
    expect((await checks.check([login("a", "breached")])).get("breached")).toBe(7);
    expect(auditService.passwordLeaked).toHaveBeenCalledTimes(2);
  });

  it("forgets everything when the vault locks or signs out", async () => {
    await checks.check([login("a", "breached")]);
    status$.next(AuthenticationStatus.Locked);
    status$.next(AuthenticationStatus.Unlocked);
    await checks.check([login("a", "breached")]);
    expect(auditService.passwordLeaked).toHaveBeenCalledTimes(2);
  });

  it("passes the run's signal and setting to each request, and is called off with them", async () => {
    const calledOff = new AbortController();
    const mayAsk = async () => true;
    auditService.passwordLeaked.mockImplementation(async () => {
      calledOff.abort();
      throw new PwnedPasswordsCancelledError();
    });
    await expect(
      checks.check([login("a", "breached")], { signal: calledOff.signal, mayAsk }),
    ).rejects.toBeInstanceOf(PwnedPasswordsCancelledError);
    expect(auditService.passwordLeaked).toHaveBeenCalledWith("breached", {
      signal: calledOff.signal,
      mayAsk,
    });
  });
});
