import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { ScriptSpec } from "@bitwarden/admin-console/common";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { SyncService } from "@bitwarden/common/platform/sync";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogService, ToastService } from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";

import { confirmChangeStandIn, PROOF } from "../confirm-change/confirm-change.test-helper";
import { KeykeeperMspApiService } from "../msp/msp-api.service";

import { KeykeeperScriptAccessComponent } from "./script-access.component";

const ORG = "11111111-2222-3333-4444-555555555555";
const ITEM = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TOKEN = "66666666-7777-8888-9999-000000000000";
const TOKEN_STRING = "pbs1_66666666777788889999000000000000_seed";

const item = Object.assign(new CipherView(), {
  id: ITEM,
  name: "Domain admin",
  organizationId: ORG,
  revisionDate: new Date("2026-10-21T09:30:00Z"),
  login: { username: "admin@contoso.example", password: "not-a-real-password-1", totp: null },
  fields: [],
});
const spec: ScriptSpec = { v: 1, username: true, password: true, totp: false, fields: [] };

function setUp() {
  const prompt = confirmChangeStandIn();
  const api = mock<KeykeeperMspApiService>();
  api.scriptTokens.mockResolvedValue([]);
  api.createScriptToken.mockResolvedValue({} as any);
  const cipherService = mock<CipherService>();
  cipherService.getAllDecrypted.mockResolvedValue([item]);
  const keyService = mock<KeyService>();
  keyService.orgKeys$.mockReturnValue(
    of({ [ORG]: new SymmetricCryptoKey(new Uint8Array(64).fill(7)) }) as any,
  );
  const accountService = { activeAccount$: of({ id: "user" }) } as unknown as AccountService;
  const encryptService = mock<EncryptService>();
  encryptService.encryptString.mockResolvedValue(new EncString("2.aXY=|ZGF0YQ==|bWFj"));
  const toastService = mock<ToastService>();
  // The New script token dialog: the person picks the item and makes the token.
  const dialogService = mock<DialogService>();
  dialogService.open.mockReturnValue({
    closed: of({
      name: "Join domain",
      expiresAt: "2027-01-01T23:59:59.999Z",
      networks: [],
      grants: [{ item, spec }],
    }),
  } as any);
  const page = TestBed.runInInjectionContext(
    () =>
      new KeykeeperScriptAccessComponent(
        api,
        cipherService,
        keyService,
        accountService,
        mock<EnvironmentService>(),
        mock<PlatformUtilsService>(),
        dialogService,
        toastService,
        mock<SyncService>(),
        prompt.service,
        encryptService,
      ),
  );
  // The section's input, as the Settings page binds it, and a token's keys
  // without WebCrypto (script-access.spec.ts checks the real ones).
  Object.assign(page, {
    organizationId: () => ORG,
    keys: {
      newToken: () => ({ id: TOKEN, seed: new Uint8Array(32) }),
      tokenKey: async () => new Uint8Array(64).fill(9),
      authHash: async () => "auth-hash",
      tokenString: () => TOKEN_STRING,
    },
  });
  return { prompt, api, toastService, page };
}

describe("making a script token", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends nothing, and shows no token, when the person cancels the prompt", async () => {
    const { prompt, api, toastService, page } = setUp();
    prompt.cancels();

    await page["newToken"]();

    expect(prompt.open.mock.calls[0][1].bodyText).toBe("keykeeperConfirmScriptToken");
    expect(api.createScriptToken).not.toHaveBeenCalled();
    expect(page["made"]()).toBeNull();
    expect(toastService.showToast).not.toHaveBeenCalled();
  });

  it("sends the token with the person's proof, and shows it once", async () => {
    const { prompt, api, page } = setUp();
    prompt.confirms();

    await page["newToken"]();

    expect(api.createScriptToken).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        id: TOKEN,
        name: "Join domain",
        authHash: "auth-hash",
        expiresAt: "2027-01-01T23:59:59.999Z",
        grants: [expect.objectContaining({ itemId: ITEM })],
      }),
      PROOF,
    );
    expect(page["made"]()).toEqual({
      name: "Join domain",
      tokenString: TOKEN_STRING,
      firstItem: "Domain admin",
    });
  });
});
