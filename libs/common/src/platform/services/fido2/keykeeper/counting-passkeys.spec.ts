import { mock, MockProxy } from "jest-mock-extended";
import { of, throwError } from "rxjs";

import { mockAccountServiceWith } from "../../../../../spec";
import { PolicyService } from "../../../../admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "../../../../admin-console/enums";
import { UserId } from "../../../../types/guid";
import { CipherType } from "../../../../vault/enums/cipher-type";
import { CipherView } from "../../../../vault/models/view/cipher.view";
import { Fido2CredentialView } from "../../../../vault/models/view/fido2-credential.view";
import { LoginView } from "../../../../vault/models/view/login.view";
import {
  Fido2AuthenticatorError,
  Fido2AuthenticatorErrorCode,
} from "../../../abstractions/fido2/fido2-authenticator.service.abstraction";
import { Fido2UserInterfaceSession } from "../../../abstractions/fido2/fido2-user-interface.service.abstraction";

import {
  COUNTING_PASSKEY_KEPT_OUT,
  countingPasskeyKeptOut,
  refuseCountingPasskeyKeptOut,
} from "./counting-passkeys";

const userId = "bound-member" as UserId;

/** A login with one passkey, the person's own unless an organization is named. */
function login(counter: number, organizationId?: string): CipherView {
  const cipher = new CipherView();
  cipher.id = "login-1";
  cipher.type = CipherType.Login;
  cipher.organizationId = organizationId;
  cipher.login = new LoginView();
  const passkey = new Fido2CredentialView();
  passkey.credentialId = "credential-1";
  passkey.rpId = "passkeys.example.test";
  passkey.counter = counter;
  cipher.login.fido2Credentials = [passkey];
  return cipher;
}

describe("a counting passkey in a login kept out of Personal", () => {
  const accountService = mockAccountServiceWith(userId);
  let policyService: MockProxy<PolicyService>;
  let informRefused: jest.Mock<Promise<void>, [string]>;
  let session: Fido2UserInterfaceSession;

  /** Whether "Remove individual vault" binds the person, as upstream's policy service answers. */
  const bound = (binds: boolean) => policyService.policyAppliesToUser$.mockReturnValue(of(binds));

  beforeEach(() => {
    policyService = mock<PolicyService>();
    informRefused = jest.fn<Promise<void>, [string]>().mockResolvedValue();
    session = mock<Fido2UserInterfaceSession>({ informRefused });
  });

  it("is refused for a bound member's own login, with our apps' words for them and only NotAllowed for the site", async () => {
    bound(true);

    const error = await refuseCountingPasskeyKeptOut(
      login(5),
      session,
      policyService,
      accountService,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Fido2AuthenticatorError);
    expect((error as Fido2AuthenticatorError).errorCode).toBe(
      Fido2AuthenticatorErrorCode.NotAllowed,
    );
    expect((error as Error).message).not.toContain("Personal");
    expect(informRefused).toHaveBeenCalledTimes(1);
    expect(informRefused).toHaveBeenCalledWith(COUNTING_PASSKEY_KEPT_OUT);
    expect(policyService.policyAppliesToUser$).toHaveBeenCalledWith(
      PolicyType.OrganizationDataOwnership,
      userId,
    );
  });

  it("says what the apps say, word for word", () => {
    expect(COUNTING_PASSKEY_KEPT_OUT).toBe(
      "Your organization keeps items out of Personal, so this login can't be changed. Its passkey counts its sign-ins, and signing in would change the login. You can move it to a shared folder in the web vault, then try again.",
    );
  });

  it("goes ahead for a passkey whose counter is 0, without asking about policies", async () => {
    bound(true);

    await expect(countingPasskeyKeptOut(login(0), policyService, accountService)).resolves.toBe(
      false,
    );
    await refuseCountingPasskeyKeptOut(login(0), session, policyService, accountService);

    expect(informRefused).not.toHaveBeenCalled();
    expect(policyService.policyAppliesToUser$).not.toHaveBeenCalled();
  });

  it("goes ahead for a login in a shared folder, which saves its counter as before", async () => {
    bound(true);

    await refuseCountingPasskeyKeptOut(
      login(5, "organization-1"),
      session,
      policyService,
      accountService,
    );

    expect(informRefused).not.toHaveBeenCalled();
    expect(policyService.policyAppliesToUser$).not.toHaveBeenCalled();
  });

  it.each([
    ["an owner of the organization", "upstream's policy service exempts owners"],
    ["an admin of the organization", "upstream's policy service exempts admins"],
    ["someone no policy binds", "no organization has the policy on"],
  ])("goes ahead for %s (%s)", async () => {
    bound(false);

    await expect(countingPasskeyKeptOut(login(5), policyService, accountService)).resolves.toBe(
      false,
    );
    await refuseCountingPasskeyKeptOut(login(5), session, policyService, accountService);

    expect(informRefused).not.toHaveBeenCalled();
  });

  it("goes ahead as before where it can't tell: no policy service, or policies that can't be read", async () => {
    await refuseCountingPasskeyKeptOut(login(5), session, undefined, accountService);
    policyService.policyAppliesToUser$.mockReturnValue(throwError(() => new Error("no state")));
    await refuseCountingPasskeyKeptOut(login(5), session, policyService, accountService);

    expect(informRefused).not.toHaveBeenCalled();
  });

  it("is refused all the same when the window can't show the words, or is closed while it does", async () => {
    bound(true);
    // A session with no way to show them, such as upstream's desktop app's.
    const quiet = {} as Fido2UserInterfaceSession;
    informRefused.mockRejectedValue(new Error("Fido2UserInterfaceSession was closed"));

    await expect(
      refuseCountingPasskeyKeptOut(login(5), quiet, policyService, accountService),
    ).rejects.toMatchObject({ errorCode: Fido2AuthenticatorErrorCode.NotAllowed });
    await expect(
      refuseCountingPasskeyKeptOut(login(5), session, policyService, accountService),
    ).rejects.toMatchObject({ errorCode: Fido2AuthenticatorErrorCode.NotAllowed });
  });
});
