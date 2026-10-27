import { webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { KeykeeperJoinSeals, MspDetails, MspJoining } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { CryptoFunctionService } from "@bitwarden/common/key-management/crypto/abstractions/crypto-function.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { SymmetricCryptoKey } from "@bitwarden/common/platform/models/domain/symmetric-crypto-key";
import { SyncService } from "@bitwarden/common/platform/sync";
import { OrganizationId } from "@bitwarden/common/types/guid";
import { OrgKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import { KeykeeperJoinSealer } from "../joining/join-sealer.service";

import { KeykeeperMspApiService, UNTRUSTED_CLIENT } from "./msp-api.service";

// Keykeeper: what an MSP admin's browser seals for the clients a server lists.
// A hacked server could list any organization the admin belongs to as a
// client, or as following the MSP's default; these check that nothing goes
// further than the clients whose client seal checks out, and the setting the
// admin saw. See DESIGN.md, "Joins a hacked server can't forge".

const MSP = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const DENTAL = "8f9a7c1e-3b2d-4e5f-9a8b-7c6d5e4f3a2b";
const LAW = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
/** The admin's own family organization: they hold its key, but it isn't a client. */
const FAMILY = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

const seals = new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto);
const keyOf = (n: number) =>
  new SymmetricCryptoKey(new Uint8Array(64).map((_, i) => (i + n) & 0xff)) as OrgKey;
const keys: Record<string, OrgKey> = { [DENTAL]: keyOf(1), [LAW]: keyOf(2), [FAMILY]: keyOf(3) };
const joinKey = (org: string) => seals.joinKey(keys[org].toEncoded());

const clientSeal = async (org: string) => seals.clientSeal(await joinKey(org), org, MSP);
const joiningSeal = async (org: string, autoConfirm: boolean, domains: string[] = []) =>
  seals.joiningSeal(await joinKey(org), org, autoConfirm, domains);

const client = (id: string, seal: string | null) => ({
  id,
  name: id,
  createdAt: "",
  preset: null as "business" | null,
  members: { confirmed: 1, accepted: 0, invited: 0, revoked: 0 },
  you: { memberId: `me-${id}`, status: 2, type: 0 },
  seal,
});

function setUp(msp: MspDetails, mspJoining?: MspJoining) {
  const apiService = mock<ApiService>();
  const sent: { method: string; path: string; body: any }[] = [];
  apiService.send.mockImplementation(async (method: string, path: string, body: any) => {
    sent.push({ method, path, body });
    if (method === "GET" && path === `/keykeeper/msp/${MSP}`) {
      return msp;
    }
    if (method === "GET" && path === `/keykeeper/msp/${MSP}/joining`) {
      return mspJoining;
    }
    if (method === "POST" && path === `/keykeeper/msp/${MSP}/staff`) {
      return { invited: false, email: body.email, role: body.role };
    }
    return {};
  });
  const accountService = { activeAccount$: new BehaviorSubject({ id: "admin" }) } as any;
  const keyService = mock<KeyService>();
  keyService.orgKeys$.mockReturnValue(
    new BehaviorSubject(keys as Record<OrganizationId, OrgKey>) as any,
  );
  const sealer = new KeykeeperJoinSealer(
    accountService as AccountService,
    keyService,
    mock<EncryptService>(),
    mock<CryptoFunctionService>(),
    apiService,
  );
  // The sealer's own seals use the browser's crypto; these use Node's, which is the same.
  (sealer as any).seals = seals;
  const api = new KeykeeperMspApiService(
    apiService,
    accountService as AccountService,
    keyService,
    mock<EncryptService>(),
    mock<I18nService>(),
    mock<SyncService>(),
    sealer,
  );
  return { api, sent };
}

const mspWith = async (...clients: ReturnType<typeof client>[]): Promise<MspDetails> => ({
  id: MSP,
  name: "Northwind IT",
  role: "admin",
  staff: [],
  invites: [],
  clients,
});

describe("Which clients an MSP admin's browser trusts", () => {
  it("only those with this MSP's client seal, made with their key", async () => {
    const msp = await mspWith(
      client(DENTAL, await clientSeal(DENTAL)),
      client(LAW, null),
      // The server lists the family organization with Dental's seal.
      client(FAMILY, await clientSeal(DENTAL)),
    );
    const { api } = setUp(msp);
    expect([...(await api.trustedClientIds(MSP))]).toEqual([DENTAL]);
  });

  it("seals a staff member's place only in those", async () => {
    const msp = await mspWith(client(DENTAL, await clientSeal(DENTAL)), client(FAMILY, null));
    const { api, sent } = setUp(msp);
    await api.addStaff(MSP, "tech@northwind.example", "admin");
    const put = sent.find((s) => s.method === "PUT" && s.path === `/keykeeper/msp/${MSP}/seals`);
    expect(put!.body.staff.map((s: { organizationId: string }) => s.organizationId)).toEqual([
      DENTAL,
    ]);
  });

  it("confirms a client by name with a client seal made with its key", async () => {
    const msp = await mspWith(client(LAW, null));
    const { api, sent } = setUp(msp);
    await api.confirmClient(MSP, LAW);
    const put = sent.find((s) => s.method === "PUT" && s.path === `/keykeeper/msp/${MSP}/seals`);
    expect(put!.body.clients).toEqual([{ organizationId: LAW, seal: await clientSeal(LAW) }]);
  });
});

describe("Saving the MSP's default for how people join", () => {
  const joiningPut = (sent: { method: string; path: string; body: any }[]) =>
    sent.find((s) => s.method === "PUT" && s.path === `/keykeeper/msp/${MSP}/joining`)!.body;

  it("reseals only trusted clients whose seal says they follow the default the admin saw", async () => {
    const msp = await mspWith(
      client(DENTAL, await clientSeal(DENTAL)),
      client(LAW, await clientSeal(LAW)),
      client(FAMILY, null),
    );
    // The admin saw "an admin approves each one" and turns on letting people in.
    const seen = { autoConfirm: false, inviteHours: 120 };
    const { api, sent } = setUp(msp, {
      default: seen,
      ownSettings: [],
      following: [
        // Follows the default the admin saw.
        {
          organizationId: DENTAL,
          domains: ["acme.example"],
          seal: await joiningSeal(DENTAL, false, ["acme.example"]),
        },
        // Says it follows, but its seal says it lets people in already: not what the admin saw.
        { organizationId: LAW, domains: [], seal: await joiningSeal(LAW, true) },
        // Not a client at all, though its seal is sound.
        { organizationId: FAMILY, domains: [], seal: await joiningSeal(FAMILY, false) },
      ],
    });

    await api.saveMspJoining(MSP, { autoConfirm: true, inviteHours: 120 }, seen);

    const body = joiningPut(sent);
    expect(Object.keys(body.seals)).toEqual([DENTAL]);
    expect(body.seals[DENTAL]).toBe(await joiningSeal(DENTAL, true, ["acme.example"]));
  });

  it("never reseals a client that chose approval when the server lists it as following", async () => {
    const msp = await mspWith(client(DENTAL, await clientSeal(DENTAL)));
    // The default lets people in; Dental chose approval, sealed as such.
    const seen = { autoConfirm: true, inviteHours: 120 };
    const { api, sent } = setUp(msp, {
      default: seen,
      ownSettings: [],
      following: [{ organizationId: DENTAL, domains: [], seal: await joiningSeal(DENTAL, false) }],
    });

    await api.saveMspJoining(MSP, { autoConfirm: true, inviteHours: 24 }, seen);

    expect(joiningPut(sent).seals).toEqual({});
  });

  it("changes nothing when the default isn't what the admin saw", async () => {
    const msp = await mspWith(client(DENTAL, await clientSeal(DENTAL)));
    const { api, sent } = setUp(msp, {
      default: { autoConfirm: true, inviteHours: 120 },
      ownSettings: [],
      following: [{ organizationId: DENTAL, domains: [], seal: await joiningSeal(DENTAL, true) }],
    });

    await expect(
      api.saveMspJoining(
        MSP,
        { autoConfirm: true, inviteHours: 120 },
        { autoConfirm: false, inviteHours: 120 },
      ),
    ).rejects.toThrow("changed since this page loaded");
    expect(sent.some((s) => s.method === "PUT")).toBe(false);
  });
});

describe("Use default", () => {
  function withOrgJoining(defaultAutoConfirm: boolean, msp?: MspDetails) {
    const setUpWith = setUp(msp ?? ({ clients: [] } as unknown as MspDetails));
    const { api, sent } = setUpWith;
    const send = (api as any).apiService.send as jest.Mock;
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (method: string, path: string, body: any) =>
      method === "GET" && path === `/keykeeper/organizations/${DENTAL}/joining`
        ? {
            autoConfirm: false,
            inviteHours: 120,
            source: "own",
            default: { autoConfirm: defaultAutoConfirm, inviteHours: 120 },
            domains: [],
            seal: await joiningSeal(DENTAL, false),
          }
        : original(method, path, body),
    );
    return { api, sent };
  }

  it("seals the default the person saw", async () => {
    const { api, sent } = withOrgJoining(true);
    await api.useDefaultJoining(DENTAL, true);
    const reset = sent.find((s) => s.method === "DELETE")!;
    expect(reset.body.seal).toBe(await joiningSeal(DENTAL, true));
  });

  it("changes nothing when the server's default isn't the one the person saw", async () => {
    const { api, sent } = withOrgJoining(true);
    await expect(api.useDefaultJoining(DENTAL, false)).rejects.toThrow(
      "changed since this page loaded",
    );
    expect(sent.some((s) => s.method === "DELETE")).toBe(false);
  });

  it("from the MSP console, only for a trusted client", async () => {
    const { api, sent } = withOrgJoining(true, await mspWith(client(DENTAL, null)));
    await expect(api.useDefaultJoining(DENTAL, true, MSP)).rejects.toThrow(UNTRUSTED_CLIENT);
    expect(sent.some((s) => s.method === "DELETE")).toBe(false);
  });
});
