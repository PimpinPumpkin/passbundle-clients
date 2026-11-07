import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { SymmetricCryptoKey } from "@bitwarden/legacy-crypto";

import { KeykeeperAgentBiometrics } from "./agent-biometrics";
import { ENROLL_BIOMETRICS, REMOVE_BIOMETRICS } from "./agent-biometrics-messages";

const ANA = "ana-id" as UserId;
const BEN = "ben-id" as UserId;
const KEY = new SymmetricCryptoKey(new Uint8Array(64).map((_, i) => i)) as UserKey;

function setup(userKey: UserKey | null = KEY) {
  const callCommand = jest.fn();
  const keyService = mock<KeyService>();
  keyService.userKey$.mockReturnValue(of(userKey));
  const accountService = mock<AccountService>();
  accountService.activeAccount$ = new BehaviorSubject({
    id: ANA,
    email: "ana@example.test",
  } as any);
  const biometrics = new KeykeeperAgentBiometrics(
    () => ({ callCommand }),
    keyService,
    accountService,
  );
  return { biometrics, callCommand };
}

describe("biometric unlock through the desktop agent", () => {
  it("gives the agent the active account's user key and reports whether the person confirmed", async () => {
    const { biometrics, callCommand } = setup();
    callCommand.mockResolvedValue({ response: true });
    expect(await biometrics.enroll(ANA)).toBe(true);
    expect(callCommand).toHaveBeenCalledWith({
      command: ENROLL_BIOMETRICS,
      userKeyB64: KEY.toBase64(),
      email: "ana@example.test",
    });
    callCommand.mockResolvedValue({ response: false });
    expect(await biometrics.enroll(ANA)).toBe(false);
  });

  it("sends nothing for another account or a locked vault, and is false without an agent", async () => {
    const { biometrics, callCommand } = setup();
    expect(await biometrics.enroll(BEN)).toBe(false);
    expect(callCommand).not.toHaveBeenCalled();

    const locked = setup(null);
    expect(await locked.biometrics.enroll(ANA)).toBe(false);
    expect(locked.callCommand).not.toHaveBeenCalled();

    callCommand.mockRejectedValue("errorConnecting");
    expect(await biometrics.enroll(ANA)).toBe(false);
  });

  it("removes a named account's key, and doesn't hold up logout when the agent is gone", async () => {
    jest.useFakeTimers();
    const { biometrics, callCommand } = setup();
    callCommand.mockResolvedValue({ response: true });
    await biometrics.remove(BEN);
    expect(callCommand).toHaveBeenCalledWith({ command: REMOVE_BIOMETRICS, forUserId: BEN });

    callCommand.mockReturnValue(new Promise(() => {}));
    const removing = biometrics.remove(ANA);
    jest.advanceTimersByTime(2000);
    await expect(removing).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
