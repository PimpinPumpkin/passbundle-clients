import { mock } from "jest-mock-extended";
import { BehaviorSubject, of } from "rxjs";

import {
  FOLDER_PRESETS,
  FolderLike,
} from "@bitwarden/common/admin-console/keykeeper/folder-permissions";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { SyncService } from "@bitwarden/common/platform/sync";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { newTemplateDefinitionField } from "@bitwarden/common/vault/keykeeper/templates";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { KeyService } from "@bitwarden/key-management";

import { CollectionAdminService } from "../collections";

import { KeykeeperMspRequests } from "./msp-requests";
import {
  KeykeeperTemplateSender,
  templateShareProblem,
  templateSourceProblem,
} from "./msp-template-sender";
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

function setup(items: CipherView[], collections = [{ id: "templates" }], orgKeys: any = {}) {
  const requests = mock<KeykeeperMspRequests>();
  requests.setTemplatesCollection.mockResolvedValue("made-by-server");
  const cipherService = mock<CipherService>();
  cipherService.getAllDecrypted.mockResolvedValue(items);
  cipherService.createWithServer.mockImplementation(async (c) => ({ ...c, id: "new-copy" }) as any);
  cipherService.updateWithServer.mockImplementation(async (c) => c as any);
  const collectionAdminService = mock<CollectionAdminService>();
  collectionAdminService.collectionAdminViews$.mockReturnValue(of(collections as any));
  const accountService = mock<AccountService>();
  accountService.activeAccount$ = new BehaviorSubject({ id: USER } as any);
  const keyService = mock<KeyService>();
  keyService.orgKeys$.mockReturnValue(of(orgKeys));
  const encryptService = mock<EncryptService>();
  encryptService.encryptString.mockResolvedValue({ encryptedString: "2.name|enc|mac" } as any);
  const sender = new KeykeeperTemplateSender(
    requests,
    cipherService,
    collectionAdminService,
    accountService,
    mock<SyncService>(),
    keyService,
    encryptService,
  );
  return { sender, cipherService, collectionAdminService, requests, encryptService };
}

const state = (cipherId: string): MspTemplates => ({
  templates: [],
  copies: [{ organizationId: "dental", templateId: "fw", cipherId, sourceRevision: "v0" }],
  collections: { dental: "templates" },
});

describe("MSP template sources", () => {
  it("are the MSP's own templates, in an organization its admins share", () => {
    expect(templateSourceProblem(template("b", "msp-shared", "fw"), ["dental"])).toBeNull();
  });

  it("are never someone's own template, whatever the server names as the source", () => {
    expect(templateSourceProblem(template("a", null, "fw"), ["dental"])).toMatch(
      /in your own vault/,
    );
  });

  it("aren't sent from someone's own vault", async () => {
    const source = template("mine", null, "fw");
    const { sender, cipherService } = setup([source]);
    await expect(
      sender.send(msp, source, [{ id: "dental", name: "Acme Dental" }], state("x")),
    ).rejects.toThrow(/in your own vault/);
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
  });

  it("are never a client's own template, a copy from an MSP, or an ordinary item", () => {
    expect(templateSourceProblem(template("a", "dental", "fw"), ["dental"])).toMatch(
      /clients' own/,
    );
    expect(
      templateSourceProblem(template("b", "msp-shared", "fw", "Other IT"), ["dental"]),
    ).toMatch(/copy from an MSP/);
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

describe("Sharing a template's item", () => {
  // Keykeeper: copying an item into clients shares it (DESIGN.md, "Folders and permissions").
  const folder = (id: string, grid: (typeof FOLDER_PRESETS)[keyof typeof FOLDER_PRESETS]) =>
    ({
      id,
      organizationId: "msp-shared",
      readOnly: !grid.edit,
      hidePasswords: !grid.seePasswords,
      manage: grid.manage,
      keykeeper: { ...grid },
    }) as FolderLike;
  const inFolders = (...ids: string[]) => {
    const source = template("src", "msp-shared", "fw");
    source.collectionIds = ids as any;
    return source;
  };
  const member = [{ id: "msp-shared", canEditAllCiphers: false }];

  it("is always the person's with their own item", () => {
    expect(templateShareProblem(template("a", null, "fw"), [], [])).toBeNull();
  });

  it("needs share in one of the folders the item is in", () => {
    const view = folder("viewing", FOLDER_PRESETS.view);
    const edit = folder("editing", FOLDER_PRESETS.edit);
    expect(templateShareProblem(inFolders("viewing"), [view], member)).toMatch(
      /can't share that template's item/,
    );
    expect(templateShareProblem(inFolders("viewing", "editing"), [view, edit], member)).toBeNull();
    // A folder the item isn't in doesn't count.
    expect(templateShareProblem(inFolders("viewing"), [view, edit], member)).not.toBeNull();
  });

  it("is an owner's or admin's for an item in no folder they reach, and nobody else's", () => {
    const admin = [{ id: "msp-shared", canEditAllCiphers: true }];
    expect(templateShareProblem(inFolders(), [], admin)).toBeNull();
    expect(templateShareProblem(inFolders(), [], member)).not.toBeNull();
    expect(
      templateShareProblem(inFolders(), [], [{ id: "elsewhere", canEditAllCiphers: true }]),
    ).not.toBeNull();
  });
});

describe("Sending a template", () => {
  it("replaces the client's earlier copy", async () => {
    const source = template("source", "msp-shared", "fw");
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
    const source = template("source", "msp-shared", "fw");
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

  it("has the server make a new Templates collection when the client deleted its own, never one of its own", async () => {
    const source = template("source", "msp-shared", "fw");
    const dentalKey = { key: "dental" };
    const { sender, cipherService, collectionAdminService, requests, encryptService } = setup(
      [source],
      [],
      { dental: dentalKey },
    );
    const result = await sender.send(
      msp,
      source,
      [{ id: "dental", name: "Acme Dental" }],
      state("gone"),
    );
    expect(result.failed).toEqual([]);
    expect(encryptService.encryptString).toHaveBeenCalledWith("Templates", dentalKey);
    expect(requests.setTemplatesCollection).toHaveBeenCalledWith(
      "msp-1",
      "dental",
      "2.name|enc|mac",
    );
    expect(collectionAdminService.create).not.toHaveBeenCalled();
    expect(cipherService.createWithServer.mock.calls[0][0].collectionIds).toEqual([
      "made-by-server",
    ]);
  });

  it("says so for a client whose key it doesn't have yet", async () => {
    const source = template("source", "msp-shared", "fw");
    const { sender, requests } = setup([source], []);
    const result = await sender.send(
      msp,
      source,
      [{ id: "dental", name: "Acme Dental" }],
      state("gone"),
    );
    expect(result.failed).toEqual([
      { id: "dental", name: "Acme Dental", error: "You don't have this client's key yet." },
    ]);
    expect(requests.setTemplatesCollection).not.toHaveBeenCalled();
  });

  it("removes only copies from an MSP", async () => {
    const copy = template("copy", "dental", "fw", "Northwind IT");
    const own = template("own", "dental", "fw");
    const login = new CipherView();
    login.id = "real-login";
    login.organizationId = "dental" as any;
    const { sender, cipherService } = setup([copy, own, login]);
    await sender.removeCopies(["copy", "own", "real-login", "missing"], new Set(["dental"]));
    expect(cipherService.softDeleteWithServer.mock.calls.map((c) => c[0])).toEqual(["copy"]);
  });

  it("removes copies only in clients this device trusts", async () => {
    const copy = template("copy", "dental", "fw", "Northwind IT");
    const family = template("family-copy", "family", "fw", "Northwind IT");
    const { sender, cipherService } = setup([copy, family]);
    await sender.removeCopies(["copy", "family-copy"], new Set(["dental"]));
    expect(cipherService.softDeleteWithServer.mock.calls.map((c) => c[0])).toEqual(["copy"]);
  });
});
