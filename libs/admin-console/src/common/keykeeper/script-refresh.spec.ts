import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperMspRequests } from "./msp-requests";
import { StaleScriptGrant } from "./msp-types";
import { KeykeeperScriptCopies } from "./script-access";
import { nodeEncrypt } from "./script-access.test-helper";
import * as grants from "./script-grants-v2.vectors.json";
import { KeykeeperScriptRefresher } from "./script-refresh";

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const ORG = grants.inputs.organizationId;
const ITEM = grants.inputs.itemId;
const TOKEN = grants.inputs.tokenId;
const OTHER_ORG = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const orgKey = new SymmetricCryptoKey(bytes(grants.inputs.organizationKey));
const tokenKey = new SymmetricCryptoKey(bytes(grants.tokenKey));
const copies = new KeykeeperScriptCopies(nodeEncrypt);
const REVISION = "2026-10-21T09:30:00.123Z";

function item(overrides: Partial<CipherView> = {}): CipherView {
  return Object.assign(new CipherView(), {
    id: ITEM,
    name: "Domain admin",
    organizationId: ORG,
    revisionDate: new Date(REVISION),
    edit: true,
    viewPassword: true,
    login: { username: "admin@contoso.example", password: "a-new-password-2", totp: null },
    fields: [{ name: "Break-glass PIN", value: "1111" }],
    ...overrides,
  });
}

const grant = (overrides: Partial<StaleScriptGrant> = {}): StaleScriptGrant => ({
  organizationId: ORG,
  tokenId: TOKEN,
  itemId: ITEM,
  revision: "2026-10-21T09:30:00.123456Z",
  sealedKey: grants.sealedTokenKey.encString,
  sealedSpec: grants.sealedSpec.encString,
  ...overrides,
});

function setUp(
  items: CipherView[],
  stale: StaleScriptGrant[] = [grant()],
  keys: Record<string, SymmetricCryptoKey> = { [ORG]: orgKey, [OTHER_ORG]: orgKey },
) {
  const requests = mock<KeykeeperMspRequests>();
  requests.staleScriptGrants.mockResolvedValue(stale);
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
    const { requests, refresher } = setUp([item()]);

    expect(await refresher.refresh()).toEqual([]);

    expect(requests.setScriptGrant).toHaveBeenCalledTimes(1);
    const [org, token, itemId, sent] = requests.setScriptGrant.mock.calls[0];
    expect([org, token, itemId]).toEqual([ORG, TOKEN, ITEM]);
    expect(sent.revision).toBe(REVISION);
    expect(sent.sealedSpec).toBe(grants.sealedSpec.encString);
    expect(await copies.decryptCopy(sent.copy, tokenKey, TOKEN, ITEM)).toEqual({
      v: 1,
      token: TOKEN,
      item: ITEM,
      revision: REVISION,
      name: "Domain admin",
      username: "admin@contoso.example",
      password: "a-new-password-2",
      fields: { "Break-glass PIN": "1111" },
    });
  });

  it("waits for an item this app hasn't synced yet, and skips items and organizations it can't see", async () => {
    for (const { items, keys } of [
      { items: [item({ revisionDate: new Date("2026-10-20T18:00:00.000Z") })], keys: undefined },
      { items: [], keys: undefined },
      { items: [item()], keys: {} },
    ]) {
      const { requests, refresher } = setUp(items, undefined, keys);
      expect(await refresher.refresh()).toEqual([]);
      expect(requests.setScriptGrant).not.toHaveBeenCalled();
    }
  });

  // What a hacked server could list as behind. None of it may produce a copy.
  it.each([
    {
      why: "the person's own item, under an organization's grant",
      items: [item({ organizationId: null })],
      stale: [grant()],
    },
    {
      why: "another organization's item, under this organization's grant",
      items: [item({ organizationId: OTHER_ORG as any })],
      stale: [grant()],
    },
    {
      why: "an item in the trash",
      items: [item({ deletedDate: new Date("2026-10-21T10:00:00Z") })],
      stale: [grant()],
    },
    {
      why: "an item the person can't edit",
      items: [item({ edit: false })],
      stale: [grant()],
    },
    {
      why: "an item whose passwords the person can't see",
      items: [item({ viewPassword: false })],
      stale: [grant()],
    },
  ])("never writes a copy of $why", async ({ items, stale }) => {
    const { requests, refresher } = setUp(items, stale);
    expect(await refresher.refresh()).toEqual([]);
    expect(requests.setScriptGrant).not.toHaveBeenCalled();
  });

  it.each(grants.refused)("never writes a copy with $why, and says so", async (r) => {
    const { requests, refresher } = setUp(
      [item()],
      [grant({ sealedKey: r.sealedKey, sealedSpec: r.sealedSpec })],
    );
    const failures = await refresher.refresh();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("A script token's copy of Domain admin wasn't updated");
    expect(requests.setScriptGrant).not.toHaveBeenCalled();
  });

  it("never writes another item's copy when the server lists a grant's seals for this one", async () => {
    // The seals are for ITEM; the server says they're for another item the person can edit.
    const other = item({ id: "99999999-4b5c-4d6e-8f70-819a2b3c4d5e" });
    const { requests, refresher } = setUp([other], [grant({ itemId: other.id })]);
    expect(await refresher.refresh()).toHaveLength(1);
    expect(requests.setScriptGrant).not.toHaveBeenCalled();
  });

  it("says when a copy couldn't be made", async () => {
    const { requests, refresher } = setUp([item()]);
    requests.setScriptGrant.mockRejectedValue(new Error("server down"));
    expect(await refresher.refresh()).toEqual([
      "A script token's copy of Domain admin wasn't updated: server down",
    ]);
  });
});
