// Keykeeper: the fingerprint phrase in the meta repo's device approval
// vectors (docs/vectors/device-approval-v1.json, copied here as
// keykeeper-device-approval.vectors.json; tier 1 checks the copy is the
// same), made by upstream's own code: the phrase the web vault and the
// extension show when they ask to sign in with a device, and when they
// approve one. PassBundle's apps make the same phrase in their core, checked
// against the same vectors there (DESIGN.md, "Approving a sign-in from
// another device").
import { mock } from "jest-mock-extended";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountCryptographicStateService } from "@bitwarden/common/key-management/account-cryptography/account-cryptographic-state.service";
import { KeyGenerationService } from "@bitwarden/common/key-management/crypto";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { FakeMasterPasswordService } from "@bitwarden/common/key-management/master-password/services/fake-master-password.service";
import { AppIdService } from "@bitwarden/common/platform/abstractions/app-id.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { StateService } from "@bitwarden/common/platform/abstractions/state.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { FakeStateProvider, mockAccountServiceWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { DefaultKeyService, KdfConfigService } from "@bitwarden/key-management";
import { NodeCryptoFunctionService } from "@bitwarden/legacy-crypto/node";

import { DefaultAuthRequestApiService } from "./auth-request-api.service";
import { AuthRequestService } from "./auth-request.service";
import * as vectors from "./keykeeper-device-approval.vectors.json";

describe("the device approval vectors' fingerprint phrases, by upstream's code", () => {
  const accountService = mockAccountServiceWith(Utils.newGuid() as UserId);
  const stateProvider = new FakeStateProvider(accountService);
  const keyService = new DefaultKeyService(
    new FakeMasterPasswordService(),
    mock<KeyGenerationService>(),
    // The real hashing and HKDF; nothing else is used.
    new NodeCryptoFunctionService(),
    mock<EncryptService>(),
    mock<PlatformUtilsService>(),
    mock<LogService>(),
    mock<StateService>(),
    accountService,
    stateProvider,
    mock<KdfConfigService>(),
    mock<AccountCryptographicStateService>(),
  );
  const authRequestService = new AuthRequestService(
    mock<AppIdService>(),
    new FakeMasterPasswordService(),
    keyService,
    mock<EncryptService>(),
    mock<ApiService>(),
    stateProvider,
    mock<DefaultAuthRequestApiService>(),
    accountService,
  );

  it.each(vectors.fingerprints.map((f) => [f.why, f]))("%s", async (_why, f) => {
    const phrase = await authRequestService.getFingerprintPhrase(
      f.email,
      Utils.fromB64ToArray(f.publicKey),
    );
    expect(phrase).toBe(f.phrase);
    expect(phrase.split("-")).toEqual(f.words);
  });
});
