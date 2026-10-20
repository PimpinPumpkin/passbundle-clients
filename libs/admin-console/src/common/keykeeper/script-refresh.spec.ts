import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperMspRequests } from "./msp-requests";
import { KeykeeperScriptCopies } from "./script-access";
import { nodeEncrypt } from "./script-access.test-helper";
import * as vectors from "./script-access.vectors.json";
import { KeykeeperScriptRefresher } from "./script-refresh";

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const ORG = vectors.inputs.organizationId;
const ITEM = vectors.inputs.itemId;
const TOKEN = vectors.inputs.tokenId;
const orgKey = new SymmetricCryptoKey(bytes(vectors.inputs.organizationKey));
const tokenKey = new SymmetricCryptoKey(bytes(vectors.tokenKey));
const copies = new KeykeeperScriptCopies(nodeEncrypt);

function item(revision: string): CipherView {
  return Object.assign(new CipherView(), {
    id: ITEM,
    name: "Domain admin",
    organizationId: ORG,
    revisionDate: new Date(revision),
    login: { username: "admin@contoso.example", password: "a-new-password-2", totp: null },
    fields: [{ name: "Break-glass PIN", value: "1111" }],
  });
}

function setUp(items: CipherView[], keys: Record<string, SymmetricCryptoKey> = { [ORG]: orgKey }) {
  const requests = mock<KeykeeperMspRequests>();
  requests.staleScriptGrants.mockResolvedValue([
    {
      organizationId: ORG,
      tokenId: TOKEN,
      itemId: ITEM,
      revision: "2026-10-21T09:30:00.123456Z",
      sealedKey: vectors.sealedTokenKey.encString,
      sealedSpec: vectors.sealedSpec.encString,
    },
  ]);
  const keyService = mock<KeyService>();
  keyService.orgKeys$.mockReturnValue(of(keys) as any);
  const cipherService = mock<CipherService>();
  cipherService.getAllDecrypted.mockResolvedValue(items);
  const accountService = {
    activeAccount$: new BehaviorSubject({ id: "user" }),
  } as unknown as AccountService;
  const refresher = new KeykeeperScriptRefresher(
    requests,
    copies,
    keyService,
    cipherService,
    accountService,
  );
  return { requests, refresher };
}

describe("KeykeeperScriptRefresher", () => {
  it("remakes a copy behind its item with the token's key and the grant's spec", async () => {
    const { requests, refresher } = setUp([item("2026-10-21T09:30:00.123Z")]);

    expect(await refresher.refresh()).toEqual([]);

    expect(requests.setScriptGrant).toHaveBeenCalledTimes(1);
    const [org, token, itemId, grant] = requests.setScriptGrant.mock.calls[0];
    expect([org, token, itemId]).toEqual([ORG, TOKEN, ITEM]);
    expect(grant.revision).toBe("2026-10-21T09:30:00.123Z");
    expect(grant.sealedSpec).toBe(vectors.sealedSpec.encString);
    expect(await copies.decryptCopy(grant.copy, tokenKey, TOKEN, ITEM)).toEqual({
      v: 1,
      token: TOKEN,
      item: ITEM,
      revision: "2026-10-21T09:30:00.123Z",
      name: "Domain admin",
      username: "admin@contoso.example",
      password: "a-new-password-2",
      fields: { "Break-glass PIN": "1111" },
    });
  });

  it("waits for an item this app hasn't synced yet, and skips items and organizations it can't see", async () => {
    for (const { items, keys } of [
      { items: [item("2026-10-20T18:00:00.000Z")], keys: undefined },
      { items: [], keys: undefined },
      { items: [item("2026-10-21T09:30:00.123Z")], keys: {} },
    ]) {
      const { requests, refresher } = setUp(items, keys);
      expect(await refresher.refresh()).toEqual([]);
      expect(requests.setScriptGrant).not.toHaveBeenCalled();
    }
  });

  it("says when a copy couldn't be made", async () => {
    const { requests, refresher } = setUp([item("2026-10-21T09:30:00.123Z")]);
    requests.setScriptGrant.mockRejectedValue(new Error("server down"));
    expect(await refresher.refresh()).toEqual([
      "A script token's copy of Domain admin wasn't updated: server down",
    ]);
  });
});
