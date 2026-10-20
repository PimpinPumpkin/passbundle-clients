import { mock } from "jest-mock-extended";
import { BehaviorSubject, of, throwError } from "rxjs";

import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@bitwarden/common/admin-console/models/domain/organization";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { newTemplateDefinitionField } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { OrganizationUserService } from "../organization-user";

import { KeykeeperJoinChecks } from "./join-checks";
import { KeykeeperMspRequests } from "./msp-requests";
import { KeykeeperTemplateSender } from "./msp-template-sender";
import { MspTemplates, PendingMember } from "./msp-types";
import { duplicateCopies, KeykeeperMspWork } from "./msp-work";

const USER = "user-1" as UserId;

function setup() {
  const requests = mock<KeykeeperMspRequests>();
  requests.organizationsPending.mockResolvedValue([]);
  const sender = mock<KeykeeperTemplateSender>();
  const accountService = mock<AccountService>();
  accountService.activeAccount$ = new BehaviorSubject({ id: USER } as any);
  const authService = mock<AuthService>();
  authService.getAuthStatus.mockResolvedValue(AuthenticationStatus.Unlocked);
  const cipherService = mock<CipherService>();
  cipherService.getAllDecrypted.mockResolvedValue([]);
  const organizationService = mock<OrganizationService>();
  const dental = {
    id: "dental",
    name: "Acme Dental",
    isOwner: true,
    isAdmin: true,
  } as Organization;
  organizationService.organizations$.mockReturnValue(of([dental]));
  const organizationUserService = mock<OrganizationUserService>();
  organizationUserService.confirmUser.mockReturnValue(of(undefined));
  const syncService = mock<SyncService>();
  // What the checks vouch for is join-checks.spec.ts's; here, whoever the server lets in automatically.
  const joinChecks = mock<KeykeeperJoinChecks>();
  joinChecks.onItsOwn.mockImplementation(async (_userId, pending) =>
    pending.filter((p) => p.autoConfirm),
  );
  const work = new KeykeeperMspWork(
    requests,
    sender,
    accountService,
    authService,
    cipherService,
    organizationService,
    organizationUserService,
    syncService,
    joinChecks,
  );
  return { work, requests, authService, organizationService, organizationUserService, joinChecks };
}

const member = (organizationId: string, memberId: string, autoConfirm = true): PendingMember => ({
  organizationId,
  memberId,
  userId: `user-${memberId}`,
  email: `${memberId}@example.test`,
  publicKey: "AAEC",
  autoConfirm,
});

describe("MSP background work", () => {
  it("confirms members waiting in clients the person has the key for, leaves the ones needing approval, and reports the ones it couldn't", async () => {
    const { work, requests, organizationUserService } = setup();
    requests.pending.mockResolvedValue([
      member("dental", "ana"),
      member("dental", "ben"),
      member("dental", "dee", false),
      member("unknown-org", "cy"),
    ]);
    organizationUserService.confirmUser.mockImplementation((_org, memberId) =>
      memberId === "ben" ? throwError(() => new Error("Already confirmed")) : of(undefined),
    );
    const updated = jest.fn();
    work.updated$.subscribe(updated);

    const result = await work.confirmPending("msp-1");

    expect(result).toEqual({
      confirmed: 1,
      failed: ["ben@example.test in Acme Dental: Already confirmed"],
    });
    expect(organizationUserService.confirmUser).toHaveBeenCalledTimes(2);
    expect(organizationUserService.confirmUser.mock.calls.map((c) => c[1])).toEqual(["ana", "ben"]);
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it("confirms only those the checks let in, and announces each on this device", async () => {
    const { work, requests, organizationUserService, joinChecks } = setup();
    requests.pending.mockResolvedValue([member("dental", "ana"), member("dental", "ben")]);
    joinChecks.onItsOwn.mockImplementation(async (_userId, pending) =>
      pending.filter((p) => p.memberId === "ben"),
    );
    const letIn: unknown[] = [];
    work.letIn$.subscribe((l) => letIn.push(l));

    expect(await work.confirmPending("msp-1")).toEqual({ confirmed: 1, failed: [] });
    expect(organizationUserService.confirmUser.mock.calls.map((c) => c[1])).toEqual(["ben"]);
    expect(letIn).toEqual([{ email: "ben@example.test", organizationName: "Acme Dental" }]);
  });

  it("does nothing while the vault is locked", async () => {
    const { work, requests, authService } = setup();
    authService.getAuthStatus.mockResolvedValue(AuthenticationStatus.Locked);
    expect(await work.run()).toEqual([]);
    expect(requests.list).not.toHaveBeenCalled();
  });

  it("runs one at a time, and once more when asked during a run", async () => {
    const { work, requests } = setup();
    let release!: () => void;
    requests.list.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );
    requests.list.mockResolvedValue([]);

    const first = work.run();
    const second = work.run();
    // Let the first run reach the MSP list, where it waits.
    for (let i = 0; i < 50 && requests.list.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(requests.list).toHaveBeenCalledTimes(1);
    release();
    await first;
    await second;
    // The request made during the first run starts a second one.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests.list).toHaveBeenCalledTimes(2);
  });

  it("in the background, confirms where the organization does so automatically and leaves the rest for an admin", async () => {
    const { work, requests, organizationUserService } = setup();
    requests.organizationsPending.mockResolvedValue([
      member("dental", "ana"),
      member("dental", "ben", false),
    ]);
    requests.list.mockResolvedValue([]);
    expect(await work.run()).toEqual([]);
    expect(organizationUserService.confirmUser).toHaveBeenCalledTimes(1);
    expect(organizationUserService.confirmUser.mock.calls[0][1]).toBe("ana");
  });

  it("doesn't ask who's waiting when the person isn't an owner or admin anywhere", async () => {
    const { work, requests, organizationService } = setup();
    organizationService.organizations$.mockReturnValue(
      of([{ id: "dental", name: "Acme Dental", isOwner: false, isAdmin: false } as Organization]),
    );
    requests.list.mockResolvedValue([]);
    await work.run();
    expect(requests.organizationsPending).not.toHaveBeenCalled();
  });

  it("only MSP admins write templates", async () => {
    const { work, requests } = setup();
    requests.organizationsPending.mockResolvedValue([]);
    requests.list.mockResolvedValue([{ id: "msp-1", name: "Northwind IT", role: "technician" }]);
    await work.run();
    expect(requests.getTemplates).not.toHaveBeenCalled();
  });
});

describe("Duplicate template copies", () => {
  const item = (id: string, organizationId: string | null, templateId: string, from?: string) => {
    const view = new CipherView();
    view.id = id;
    view.organizationId = organizationId as any;
    view.fields = [newTemplateDefinitionField("note", templateId, from)];
    return view;
  };
  const state: MspTemplates = {
    templates: [],
    copies: [
      { organizationId: "dental", templateId: "fw", cipherId: "kept", sourceRevision: "v1" },
    ],
    collections: {},
  };

  it("are the MSP's copies in a client other than the recorded one", () => {
    const deleted = item("old", "dental", "fw", "Northwind IT");
    deleted.deletedDate = new Date();
    expect(
      duplicateCopies(state, [
        item("kept", "dental", "fw", "Northwind IT"),
        item("extra", "dental", "fw", "Northwind IT"),
        deleted,
        // Another client's copy, the client's own template, and the source.
        item("law-copy", "law", "fw", "Northwind IT"),
        item("own", "dental", "fw"),
        item("source", null, "fw"),
      ]),
    ).toEqual(["extra"]);
  });

  it("are left alone when the recorded copy is gone", () => {
    expect(duplicateCopies(state, [item("extra", "dental", "fw", "Northwind IT")])).toEqual([]);
  });
});
