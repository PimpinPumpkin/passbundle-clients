import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { newTemplateDefinitionField } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { CollectionAdminService } from "../collections";

import { KeykeeperMspRequests } from "./msp-requests";
import { KeykeeperTemplateSender, templateSourceProblem } from "./msp-template-sender";
import { MspTemplates } from "./msp-types";

const USER = "user-1" as UserId;
const msp = { id: "msp-1", name: "Northwind IT", clients: [{ id: "dental" }, { id: "law" }] };

const template = (id: string, organizationId: string | null, templateId: string, from?: string) => {
  const view = new CipherView();
  view.id = id;
  view.name = `Item ${id}`;
  view.type = CipherType.SecureNote;
  view.organizationId = organizationId as any;
  view.revisionDate = new Date("2026-10-01T00:00:00Z");
  view.fields = [newTemplateDefinitionField("note", templateId, from)];
  return view;
};

function setup(items: CipherView[]) {
  const requests = mock<KeykeeperMspRequests>();
  const cipherService = mock<CipherService>();
  cipherService.getAllDecrypted.mockResolvedValue(items);
  cipherService.createWithServer.mockImplementation(async (c) => ({ ...c, id: "new-copy" }) as any);
  cipherService.updateWithServer.mockImplementation(async (c) => c as any);
  const collectionAdminService = mock<CollectionAdminService>();
  collectionAdminService.collectionAdminViews$.mockReturnValue(of([{ id: "templates" } as any]));
  const accountService = mock<AccountService>();
  accountService.activeAccount$ = new BehaviorSubject({ id: USER } as any);
  const sender = new KeykeeperTemplateSender(
    requests,
    cipherService,
    collectionAdminService,
    accountService,
    mock<SyncService>(),
  );
  return { sender, cipherService, requests };
}

const state = (cipherId: string): MspTemplates => ({
  templates: [],
  copies: [{ organizationId: "dental", templateId: "fw", cipherId, sourceRevision: "v0" }],
  collections: { dental: "templates" },
});

describe("MSP template sources", () => {
  it("are the MSP's own templates, in a personal vault or a shared organization", () => {
    expect(templateSourceProblem(template("a", null, "fw"), ["dental"])).toBeNull();
    expect(templateSourceProblem(template("b", "msp-shared", "fw"), ["dental"])).toBeNull();
  });

  it("are never a client's own template, a copy from an MSP, or an ordinary item", () => {
    expect(templateSourceProblem(template("a", "dental", "fw"), ["dental"])).toMatch(
      /clients' own/,
    );
    expect(templateSourceProblem(template("b", null, "fw", "Other IT"), ["dental"])).toMatch(
      /copy from an MSP/,
    );
    const login = new CipherView();
    login.type = CipherType.Login;
    expect(templateSourceProblem(login, ["dental"])).toMatch(/isn't a template/);
  });

  it("aren't sent when the server names a client's template", async () => {
    const source = template("theirs", "law", "fw");
    const { sender, cipherService } = setup([source]);
    await expect(
      sender.send(msp, source, [{ id: "dental", name: "Acme Dental" }], state("x")),
    ).rejects.toThrow(/clients' own/);
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
    expect(cipherService.updateWithServer).not.toHaveBeenCalled();
  });
});

describe("Sending a template", () => {
  it("replaces the client's earlier copy", async () => {
    const source = template("source", null, "fw");
    const copy = template("copy", "dental", "fw", "Northwind IT");
    const { sender, cipherService } = setup([source, copy]);
    const result = await sender.send(
      msp,
      source,
      [{ id: "dental", name: "Acme Dental" }],
      state("copy"),
    );
    expect(result.failed).toEqual([]);
    expect(cipherService.updateWithServer.mock.calls[0][0].id).toBe("copy");
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
  });

  it("never overwrites an item that isn't a copy of it, whatever the server recorded", async () => {
    const source = template("source", null, "fw");
    const login = new CipherView();
    login.id = "real-login";
    login.type = CipherType.Login;
    login.login = new LoginView();
    login.organizationId = "dental" as any;
    const ownTemplate = template("own", "dental", "fw");
    for (const recorded of [login, ownTemplate]) {
      const { sender, cipherService } = setup([source, recorded]);
      await sender.send(msp, source, [{ id: "dental", name: "Acme Dental" }], state(recorded.id));
      expect(cipherService.updateWithServer).not.toHaveBeenCalled();
      expect(cipherService.createWithServer).toHaveBeenCalledTimes(1);
      expect(cipherService.createWithServer.mock.calls[0][0].organizationId).toBe("dental");
    }
  });

  it("removes only copies from an MSP", async () => {
    const copy = template("copy", "dental", "fw", "Northwind IT");
    const own = template("own", "dental", "fw");
    const login = new CipherView();
    login.id = "real-login";
    login.organizationId = "dental" as any;
    const { sender, cipherService } = setup([copy, own, login]);
    await sender.removeCopies(["copy", "own", "real-login", "missing"]);
    expect(cipherService.softDeleteWithServer.mock.calls.map((c) => c[0])).toEqual(["copy"]);
  });
});
