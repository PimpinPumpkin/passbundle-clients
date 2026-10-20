import { createHash, webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { KeykeeperJoinSeals } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { CryptoFunctionService } from "@bitwarden/common/key-management/crypto/abstractions/crypto-function.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { EncString } from "@bitwarden/common/key-management/crypto/models/enc-string";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import {
  Environment,
  EnvironmentService,
} from "@bitwarden/common/platform/abstractions/environment.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { KeyService } from "@bitwarden/key-management";

import { EnrollmentPlatform, EnrollmentState, KeykeeperEnrollment } from "./enrollment";
import { JoinRequest } from "./join-request";

const userId = "user-1" as UserId;
const token = "t".repeat(43);
const server = "https://vault.example.test";
const orgPublicKey = Utils.fromBufferToB64(new Uint8Array([1, 2, 3, 4]).buffer);
const seals = new KeykeeperJoinSeals(webcrypto.subtle as unknown as SubtleCrypto);
const joinSecret = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const userPublicKey = new Uint8Array([9, 8, 7, 6]);
const fingerprintOf = (b64: string) =>
  createHash("sha256").update(Buffer.from(b64, "base64")).digest("base64url");

const cryptoFunctionService = mock<CryptoFunctionService>();
cryptoFunctionService.hash.mockImplementation(
  async (value) => new Uint8Array(createHash("sha256").update(value).digest()),
);

async function hash(value: string) {
  return Utils.fromBufferToHex((await cryptoFunctionService.hash(value, "sha256")).buffer);
}

type Options = {
  managedToken?: string | null;
  managedServer?: string | null;
  accountServer?: string;
  saved?: EnrollmentState;
  answer?: boolean | null | undefined;
  msps?: unknown[];
  organizations?: Partial<Organization>[];
  joinParts?: { secret: string | null; orgKey: string | null };
};

function setUp(options: Options = {}) {
  const {
    managedToken = token,
    managedServer = server,
    accountServer = server,
    saved = {},
    msps = [],
    organizations = [],
    joinParts = { secret: joinSecret, orgKey: fingerprintOf(orgPublicKey) },
  } = options;
  // An explicit undefined means the window couldn't open.
  const answer = "answer" in options ? options.answer : true;
  const apiService = mock<ApiService>();
  const keyService = mock<KeyService>();
  const encryptService = mock<EncryptService>();
  const syncService = mock<SyncService>();
  const environmentService = mock<EnvironmentService>();
  environmentService.getEnvironment$.mockReturnValue(
    new BehaviorSubject({ getWebVaultUrl: () => accountServer } as Environment),
  );
  const organizationService = mock<OrganizationService>();
  organizationService.organizations$.mockReturnValue(
    new BehaviorSubject(organizations as Organization[]),
  );
  const userKey = { key: "user-key" } as unknown as UserKey;
  keyService.userKey$.mockReturnValue(new BehaviorSubject(userKey));
  keyService.getFingerprint.mockResolvedValue(["alpha", "bravo", "charlie"]);
  keyService.userPublicKey$.mockReturnValue(new BehaviorSubject(userPublicKey));
  encryptService.encapsulateKeyUnsigned.mockResolvedValue({
    encryptedString: "4.recovery",
  } as EncString);
  let state = saved;
  const notices: [string, string][] = [];
  const asked: JoinRequest[] = [];
  const platform: EnrollmentPlatform = {
    managedToken: async () => managedToken,
    managedServer: async () => managedServer,
    managedJoinParts: async () => joinParts,
    load: async () => JSON.parse(JSON.stringify(state)),
    save: async (next) => {
      state = next;
    },
    notify: async (title, message) => {
      notices.push([title, message]);
    },
    ask: async (request) => {
      asked.push(request);
      return answer;
    },
    onAnswered: () => {},
  };
  const enrollment = new KeykeeperEnrollment(
    mock<AccountService>(),
    mock<AuthService>(),
    apiService,
    keyService,
    encryptService,
    syncService,
    environmentService,
    organizationService,
    cryptoFunctionService,
    platform,
    seals,
  );
  /** Answers the server's endpoints: the person's MSPs, the token's organization, then the join. */
  const respond = (
    info: object,
    join: Promise<{ status: number }> = Promise.resolve({ status: 1 }),
  ) =>
    apiService.send.mockImplementation(async (_method, path) => {
      switch (path) {
        case "/keykeeper/msp":
          return { data: msps };
        case "/keykeeper/enrollment/info":
          return info;
        case "/keykeeper/enrollment/join":
          return join;
      }
      throw new Error(`unexpected ${path}`);
    });
  const info = (accountRecovery: boolean, publicKey: string | null = orgPublicKey) => ({
    organizationId: "org-1",
    organizationName: "Acme Dental",
    publicKey,
    accountRecovery,
  });
  const paths = () => apiService.send.mock.calls.map((c) => c[1]);
  return {
    enrollment,
    apiService,
    encryptService,
    syncService,
    userKey,
    notices,
    asked,
    paths,
    respond,
    state: () => state,
    info,
  };
}

describe("Keykeeper enrollment through the install command", () => {
  it("does nothing without a token from browser policy", async () => {
    const { enrollment, apiService } = setUp({ managedToken: null });

    expect(await enrollment.run(userId)).toBe("no-token");
    expect(apiService.send).not.toHaveBeenCalled();
  });

  it("never sends the token to a server other than the one browser policy names", async () => {
    for (const options of [
      { accountServer: "https://vault.other.test" },
      { accountServer: "https://vault.example.test:8443" },
      { managedServer: null },
      { managedServer: "not a url" },
    ]) {
      const { enrollment, apiService } = setUp(options);
      expect(await enrollment.run(userId)).toBe("other-server");
      expect(apiService.send).not.toHaveBeenCalled();
    }
  });

  it("asks first, then joins with the user key encrypted to the organization's public key when it uses account recovery", async () => {
    const t = setUp();
    t.respond(t.info(true));

    expect(await t.enrollment.run(userId)).toBe("joined");

    expect(t.asked).toEqual([
      {
        organizationName: "Acme Dental",
        accountRecovery: true,
        fingerprint: ["alpha", "bravo", "charlie"],
        adminElsewhere: [],
      },
    ]);
    expect(t.paths()).toEqual([
      "/keykeeper/msp",
      "/keykeeper/enrollment/info",
      "/keykeeper/enrollment/join",
    ]);
    expect(t.encryptService.encapsulateKeyUnsigned).toHaveBeenCalledWith(
      t.userKey,
      Utils.fromB64ToArray(orgPublicKey),
    );
    expect(t.apiService.send).toHaveBeenLastCalledWith(
      "POST",
      "/keykeeper/enrollment/join",
      {
        token,
        resetPasswordKey: "4.recovery",
        proof: await seals.joinProof(joinSecret, "org-1", userId, userPublicKey),
      },
      true,
      true,
    );
    expect(t.notices).toEqual([["You joined Acme Dental", "An admin will confirm you shortly."]]);
    // Remembered by the token's hash, never the token.
    expect(t.state()[userId]).toEqual({ tokenHash: await hash(token), result: "joined" });
    expect(JSON.stringify(t.state())).not.toContain(token);
    expect(t.syncService.fullSync).toHaveBeenCalledWith(true);
  });

  it("sends no recovery key when the organization doesn't use account recovery", async () => {
    const t = setUp();
    t.respond(t.info(false));

    await t.enrollment.run(userId);

    expect(t.encryptService.encapsulateKeyUnsigned).not.toHaveBeenCalled();
    expect(t.apiService.send).toHaveBeenLastCalledWith(
      "POST",
      "/keykeeper/enrollment/join",
      expect.objectContaining({ token, resetPasswordKey: undefined }),
      true,
      true,
    );
  });

  it("joins nothing and escrows nothing when the person says not now, and asks again a week later", async () => {
    for (const answer of [false, null]) {
      const t = setUp({ answer });
      t.respond(t.info(true));

      expect(await t.enrollment.run(userId)).toBe("declined");

      expect(t.paths()).not.toContain("/keykeeper/enrollment/join");
      expect(t.encryptService.encapsulateKeyUnsigned).not.toHaveBeenCalled();
      expect(t.state()[userId].result).toBe("declined");
    }

    const tokenHash = await hash(token);
    const recently = setUp({
      saved: { [userId]: { tokenHash, result: "declined", at: Date.now() - 60_000 } },
    });
    expect(await recently.enrollment.run(userId)).toBe("declined");
    expect(recently.apiService.send).not.toHaveBeenCalled();

    const weekAgo = setUp({
      saved: { [userId]: { tokenHash, result: "declined", at: Date.now() - 8 * 86_400_000 } },
    });
    weekAgo.respond(weekAgo.info(false));
    expect(await weekAgo.enrollment.run(userId)).toBe("joined");
  });

  it("tries again later when it couldn't ask, rather than taking it as not now", async () => {
    const t = setUp({ answer: undefined });
    t.respond(t.info(false));

    expect(await t.enrollment.run(userId)).toBe("failed");
    expect(t.paths()).not.toContain("/keykeeper/enrollment/join");
    expect(t.state()[userId].result).toEqual({ error: expect.stringContaining("Couldn't open") });
  });

  it("refuses an organization key that isn't the one the install command names, before asking", async () => {
    const t = setUp({ joinParts: { secret: joinSecret, orgKey: fingerprintOf("AAAA") } });
    t.respond(t.info(true));

    expect(await t.enrollment.run(userId)).toBe("failed");
    expect(t.asked).toEqual([]);
    expect(t.paths()).not.toContain("/keykeeper/enrollment/join");
    expect(t.encryptService.encapsulateKeyUnsigned).not.toHaveBeenCalled();
    expect(t.notices[0][1]).toContain("isn't the one your IT's install command names");
  });

  it("needs a command that names the organization's key before escrowing for account recovery", async () => {
    const old = setUp({ joinParts: { secret: null, orgKey: null } });
    old.respond(old.info(true));
    expect(await old.enrollment.run(userId)).toBe("failed");
    expect(old.encryptService.encapsulateKeyUnsigned).not.toHaveBeenCalled();
    expect(old.notices[0][1]).toContain("needs a newer install command");

    // Without account recovery, an older command still joins, with no proof: an admin approves.
    const noRecovery = setUp({ joinParts: { secret: null, orgKey: null } });
    noRecovery.respond(noRecovery.info(false));
    expect(await noRecovery.enrollment.run(userId)).toBe("joined");
    expect(noRecovery.apiService.send).toHaveBeenLastCalledWith(
      "POST",
      "/keykeeper/enrollment/join",
      { token, resetPasswordKey: undefined, proof: undefined },
      true,
      true,
    );
  });

  it("leaves MSP staff alone: they sign in on clients' computers but never join this way", async () => {
    const t = setUp({ msps: [{ id: "msp-1", name: "Northwind IT", role: "technician" }] });
    t.respond(t.info(true));

    expect(await t.enrollment.run(userId)).toBe("msp-staff");
    expect(t.paths()).toEqual(["/keykeeper/msp"]);
    expect(t.asked).toEqual([]);
  });

  it("tells someone who is an owner or admin elsewhere that account recovery would reach it too", async () => {
    const t = setUp({
      organizations: [
        { id: "family", name: "Family", isOwner: true, isAdmin: true } as Partial<Organization>,
        { id: "club", name: "Book Club", isOwner: false, isAdmin: false } as Partial<Organization>,
      ],
    });
    t.respond(t.info(true));

    await t.enrollment.run(userId);

    expect(t.asked[0].adminElsewhere).toEqual(["Family"]);
  });

  it("doesn't ask someone already in the organization", async () => {
    const t = setUp({
      organizations: [{ id: "org-1", name: "Acme Dental" } as Partial<Organization>],
    });
    t.respond(t.info(true));

    expect(await t.enrollment.run(userId)).toBe("already-done");
    expect(t.asked).toEqual([]);
  });

  it("joins once per account and token, and asks again for a new token", async () => {
    const tokenHash = await hash(token);
    const done = setUp({ saved: { [userId]: { tokenHash, result: "joined" } } });
    expect(await done.enrollment.run(userId)).toBe("already-done");
    expect(done.apiService.send).not.toHaveBeenCalled();

    const replaced = setUp({
      managedToken: "n".repeat(43),
      saved: { [userId]: { tokenHash, result: "joined" } },
    });
    replaced.respond(replaced.info(false), Promise.resolve({ status: 2 }));
    expect(await replaced.enrollment.run(userId)).toBe("joined");
    expect(replaced.asked).toHaveLength(1);
    // Already a member: nothing to announce.
    expect(replaced.notices).toEqual([]);
  });

  it("never sends a recovery key without the organization's public key", async () => {
    const t = setUp();
    t.respond(t.info(true, null));

    expect(await t.enrollment.run(userId)).toBe("failed");
    expect(t.encryptService.encapsulateKeyUnsigned).not.toHaveBeenCalled();
    expect(t.paths()).not.toContain("/keykeeper/enrollment/join");
    // The command names a key, and the server gave none.
    expect(t.notices[0][1]).toContain("isn't the one your IT's install command names");
  });

  it("runs once at a time for an account", async () => {
    const t = setUp();
    t.respond(t.info(false));

    const [first, second] = await Promise.all([t.enrollment.run(userId), t.enrollment.run(userId)]);

    expect([first, second]).toEqual(["joined", "joined"]);
    expect(t.asked).toHaveLength(1);
  });

  it("tells the person about a problem once, not at every unlock", async () => {
    const refused = new ErrorResponse(
      { message: "Cannot join because another organization policy forbids it" },
      400,
    );
    const t = setUp();
    t.respond(t.info(false), Promise.reject(refused));
    expect(await t.enrollment.run(userId)).toBe("failed");
    expect(t.notices).toEqual([
      [
        "Couldn't join your organization",
        "Cannot join because another organization policy forbids it",
      ],
    ]);

    const again = setUp({ saved: t.state() });
    again.respond(again.info(false), Promise.reject(refused));
    expect(await again.enrollment.run(userId)).toBe("failed");
    expect(again.notices).toEqual([]);
  });
});
