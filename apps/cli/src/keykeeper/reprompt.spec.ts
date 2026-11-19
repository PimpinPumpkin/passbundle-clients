// Keykeeper: "Master password re-prompt" in the command-line tool
// (reprompt.ts): each command that shows or changes an item's secrets asks
// for the master password, or refuses where it can't ask, unless the run was
// approved with --reprompt-ok; every other output gives the item's plain
// values only; and `serve`'s routes never ask, and can't be approved by a
// request.

import * as http from "http";
import { AddressInfo } from "net";

import { Router } from "@koa/router";
import { mock } from "jest-mock-extended";
import * as koa from "koa";
import * as koaBodyParser from "koa-bodyparser";
import { of } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FolderApiServiceAbstraction } from "@bitwarden/common/vault/abstractions/folder/folder-api.service.abstraction";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { SearchService } from "@bitwarden/common/vault/abstractions/search.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherRepromptType, CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";
import { CipherAuthorizationService } from "@bitwarden/common/vault/services/cipher-authorization.service";
import { KeyService } from "@bitwarden/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, LegacyCompatKeyService } from "@bitwarden/legacy-crypto";
import { VaultExportServiceAbstraction } from "@bitwarden/vault-export-core";

import { EditCommand } from "../commands/edit.command";
import { GetCommand } from "../commands/get.command";
import { StringResponse } from "../models/response/string.response";
import { OssServeConfigurator } from "../oss-serve-configurator";
import { ServiceContainer } from "../service-container/service-container";
import { ExportCommand } from "../tools/export.command";
import { CipherResponse } from "../vault/models/cipher.response";
import { CliRestrictedItemTypesService } from "../vault/services/cli-restricted-item-types.service";

import {
  approveReprompted,
  resetReprompt,
  scriptRefusal,
  serveRefusal,
  useMasterPasswordCheck,
  WRONG_PASSWORD,
} from "./reprompt";

// The master password prompt (inquirer), answered by each test.
const prompted: string[] = [];
let typed = "";
jest.mock("inquirer", () => ({
  createPromptModule: () => async (question: { message: string }) => {
    prompted.push(question.message);
    return { password: typed };
  },
}));

const ID = "11111111-1111-1111-1111-111111111111";
const MASTER_PASSWORD = "correct horse battery staple";

/** A login that asks for the master password again, with a secret of each kind. */
function guarded(reprompt: CipherRepromptType = CipherRepromptType.Password) {
  const item = new CipherView();
  item.id = ID;
  item.type = CipherType.Login;
  item.name = "Domain admin";
  item.notes = "recovery codes: 1111 2222";
  item.reprompt = reprompt;
  item.viewPassword = true;
  item.login.username = "administrator";
  item.login.password = "real-password";
  item.login.totp = "JBSWY3DPEHPK3PXP";
  item.fields = [
    Object.assign(new FieldView(), { type: FieldType.Hidden, name: "PIN", value: "4321" }),
    Object.assign(new FieldView(), { type: FieldType.Text, name: "Site", value: "HQ" }),
  ];
  item.passwordHistory = [Object.assign(new PasswordHistoryView(), { password: "old-password" })];
  return item;
}

/** Stands for the terminal: interaction allowed or not, and stdin and stderr terminals or not. */
function terminal(interactive: boolean) {
  if (interactive) {
    delete process.env.BW_NOINTERACTION;
  } else {
    process.env.BW_NOINTERACTION = "true";
  }
  Object.defineProperty(process.stdin, "isTTY", { value: interactive, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: interactive, configurable: true });
}

describe("master password re-prompt", () => {
  const saved = {
    noInteraction: process.env.BW_NOINTERACTION,
    serve: process.env.BW_SERVE,
    stdin: process.stdin.isTTY,
    stderr: process.stderr.isTTY,
  };
  const cipherService = mock<CipherService>();
  const totpService = mock<TotpService>();
  const auditService = mock<AuditService>();
  const accountService = mock<AccountService>();
  const profile = mock<BillingAccountProfileStateService>();
  const restricted = mock<CliRestrictedItemTypesService>();
  const verify = jest.fn<Promise<boolean>, [string]>();
  let hasMasterPassword = true;
  let item: CipherView;
  let get: GetCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    resetReprompt();
    prompted.length = 0;
    typed = "";
    hasMasterPassword = true;
    delete process.env.BW_SERVE;
    item = guarded();
    verify.mockImplementation(async (password) => {
      if (password !== MASTER_PASSWORD) {
        throw new Error("Invalid master password");
      }
      return true;
    });
    useMasterPasswordCheck({ hasMasterPassword: async () => hasMasterPassword, verify });
    accountService.activeAccount$ = of({
      id: "user-id" as UserId,
      ...mockAccountInfoWith({ email: "ana@contoso.example", name: "Ana" }),
    });
    profile.hasPremiumFromAnySource$.mockReturnValue(of(true));
    restricted.isCipherRestricted.mockResolvedValue(false);
    cipherService.get.mockImplementation(async () => ({ id: ID }) as Cipher);
    cipherService.decrypt.mockImplementation(async () => item);
    totpService.getCode$.mockReturnValue(of({ code: "123456", period: 30 }));
    auditService.passwordLeaked.mockResolvedValue(3);
    get = new GetCommand(
      cipherService,
      mock<FolderService>(),
      mock<CollectionService>(),
      totpService,
      auditService,
      mock<KeyService>(),
      mock<LegacyCompatKeyService>(),
      mock<EncryptService>(),
      mock<SearchService>(),
      mock<ApiService>(),
      mock<OrganizationService>(),
      mock<EventCollectionService>(),
      profile,
      accountService,
      restricted,
      mock<ConfigService>(),
    );
  });

  afterAll(() => {
    process.env.BW_NOINTERACTION = saved.noInteraction;
    if (saved.serve === undefined) {
      delete process.env.BW_SERVE;
    }
    Object.defineProperty(process.stdin, "isTTY", { value: saved.stdin, configurable: true });
    Object.defineProperty(process.stderr, "isTTY", { value: saved.stderr, configurable: true });
    resetReprompt();
  });

  const SECRETS: [string, string][] = [
    ["password", "real-password"],
    ["totp", "123456"],
    ["notes", "recovery codes: 1111 2222"],
    ["exposed", "3"],
  ];

  describe("in a script, which can't ask", () => {
    beforeEach(() => terminal(false));

    it.each([...SECRETS.map(([object]) => object), "item"])("refuses `get %s`", async (object) => {
      const response = await get.run(object, ID, {});
      expect(response.success).toBe(false);
      expect(response.message).toBe(scriptRefusal());
      expect(prompted).toEqual([]);
      expect(totpService.getCode$).not.toHaveBeenCalled();
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();
    });

    it("refuses `get attachment`", async () => {
      const response = await get.run("attachment", "photo.jpg", { itemid: ID });
      expect(response.message).toBe(scriptRefusal());
    });

    it("still gives what isn't secret, such as its username", async () => {
      expect(((await get.run("username", ID, {})).data as StringResponse).data).toBe(
        "administrator",
      );
    });

    it.each(SECRETS)("gives `get %s` with --reprompt-ok", async (object, value) => {
      approveReprompted();
      expect(((await get.run(object, ID, {})).data as StringResponse).data).toBe(value);
      expect(prompted).toEqual([]);
    });

    it("gives the whole item with --reprompt-ok", async () => {
      approveReprompted();
      const shown = (await get.run("item", ID, {})).data as CipherResponse;
      expect(shown.login?.password).toBe("real-password");
      expect(shown.notes).toBe("recovery codes: 1111 2222");
      expect(shown.fields?.[0].value).toBe("4321");
    });

    it("asks nothing for an item that doesn't ask", async () => {
      item = guarded(CipherRepromptType.None);
      expect(((await get.run("password", ID, {})).data as StringResponse).data).toBe(
        "real-password",
      );
    });

    it("asks nothing for an account without a master password, as the other apps", async () => {
      hasMasterPassword = false;
      expect(((await get.run("password", ID, {})).data as StringResponse).data).toBe(
        "real-password",
      );
      expect(prompted).toEqual([]);
    });

    it("keeps refusing an item whose secrets the person can't see, before any re-prompt", async () => {
      item.viewPassword = false;
      approveReprompted();
      const response = await get.run("password", ID, {});
      expect(response.message).toContain("You can't see this item's passwords");
    });
  });

  describe("in a terminal", () => {
    beforeEach(() => terminal(true));

    it.each(SECRETS)(
      "asks before `get %s`, and gives it for the master password",
      async (object, value) => {
        typed = MASTER_PASSWORD;
        expect(((await get.run(object, ID, {})).data as StringResponse).data).toBe(value);
        expect(prompted).toEqual(["Master password (this item asks for it again):"]);
        expect(verify).toHaveBeenCalledWith(MASTER_PASSWORD);
      },
    );

    it("asks before `get item`, then shows all of it", async () => {
      typed = MASTER_PASSWORD;
      const shown = (await get.run("item", ID, {})).data as CipherResponse;
      expect(prompted).toHaveLength(1);
      expect(shown.login?.password).toBe("real-password");
      expect(shown.login?.totp).toBe("JBSWY3DPEHPK3PXP");
      expect(shown.notes).toBe("recovery codes: 1111 2222");
      expect(shown.passwordHistory[0].password).toBe("old-password");
    });

    it("refuses a wrong master password, and an empty one", async () => {
      for (const wrong of ["guess", ""]) {
        resetReprompt();
        typed = wrong;
        const response = await get.run("password", ID, {});
        expect(response.message).toBe(WRONG_PASSWORD);
      }
    });

    it("asks once per item in a run", async () => {
      typed = MASTER_PASSWORD;
      await get.run("password", ID, {});
      await get.run("totp", ID, {});
      expect(prompted).toHaveLength(1);
    });
  });

  describe("everywhere else: plain values only", () => {
    it("leaves out its secrets and its notes until the run asks or is approved", () => {
      const shown = new CipherResponse(item);
      expect(shown.reprompt).toBe(CipherRepromptType.Password);
      expect(shown.name).toBe("Domain admin");
      expect(shown.login?.username).toBe("administrator");
      expect(shown.login?.password).toBeNull();
      expect(shown.login?.totp).toBeNull();
      expect(shown.notes).toBeNull();
      expect(shown.fields?.map((f) => [f.name, f.value])).toEqual([
        ["PIN", null],
        ["Site", "HQ"],
      ]);
      expect(shown.passwordHistory).toBeUndefined();
      // The item itself is unchanged.
      expect(item.login.password).toBe("real-password");
      expect(item.notes).toBe("recovery codes: 1111 2222");

      approveReprompted();
      const approved = new CipherResponse(item);
      expect(approved.login?.password).toBe("real-password");
      expect(approved.notes).toBe("recovery codes: 1111 2222");
    });
  });

  describe("edit item", () => {
    const authorization = mock<CipherAuthorizationService>();
    const policyService = mock<PolicyService>();
    let edit: EditCommand;
    const request = Buffer.from(
      JSON.stringify({ type: CipherType.Login, name: "Renamed", login: { password: null } }),
    ).toString("base64");

    beforeEach(() => {
      authorization.canEditCipher$.mockReturnValue(of(true));
      policyService.policyAppliesToUser$.mockReturnValue(of(false));
      cipherService.updateWithServer.mockImplementation(async (view: CipherView) => view);
      edit = new EditCommand(
        cipherService,
        mock<FolderService>(),
        mock<KeyService>(),
        mock<EncryptService>(),
        mock<ApiService>(),
        mock<FolderApiServiceAbstraction>(),
        accountService,
        restricted,
        policyService,
        profile,
        authorization,
      );
    });

    it("refuses in a script, so its plain values piped back can't overwrite its secrets", async () => {
      terminal(false);
      const response = await edit.run("item", ID, request, {});
      expect(response.message).toBe(scriptRefusal());
      expect(cipherService.updateWithServer).not.toHaveBeenCalled();
    });

    it("asks in a terminal, and edits for the master password", async () => {
      terminal(true);
      typed = MASTER_PASSWORD;
      const response = await edit.run("item", ID, request, {});
      expect(prompted).toHaveLength(1);
      expect(response.success).toBe(true);
      expect(cipherService.updateWithServer).toHaveBeenCalled();
    });

    it("edits with --reprompt-ok", async () => {
      terminal(false);
      approveReprompted();
      expect((await edit.run("item", ID, request, {})).success).toBe(true);
    });
  });

  describe("export", () => {
    const exportService = mock<VaultExportServiceAbstraction>();
    const policyService = mock<PolicyService>();
    let exporter: ExportCommand;

    beforeEach(() => {
      terminal(false);
      policyService.policyAppliesToUser$.mockReturnValue(of(false));
      exportService.getExport.mockResolvedValue({
        type: "text/plain",
        data: "{}",
        fileName: "x.json",
      });
      exporter = new ExportCommand(
        exportService,
        policyService,
        mock<EventCollectionService>(),
        accountService,
        cipherService,
      );
    });

    it("refuses in a script when what it would write holds such an item", async () => {
      cipherService.getAllDecrypted.mockResolvedValue([guarded(CipherRepromptType.None), item]);
      const response = await exporter.run({ format: "json" });
      expect(response.message).toBe(scriptRefusal("This export holds items that ask"));
      expect(exportService.getExport).not.toHaveBeenCalled();
    });

    it("goes on when none of what it writes asks: an organization's item doesn't count for a personal export", async () => {
      item.organizationId = "22222222-2222-2222-2222-222222222222";
      cipherService.getAllDecrypted.mockResolvedValue([item]);
      await exporter.run({ format: "json", output: "/dev/null" });
      expect(exportService.getExport).toHaveBeenCalled();
    });

    it("goes on with --reprompt-ok", async () => {
      cipherService.getAllDecrypted.mockResolvedValue([item]);
      approveReprompted();
      await exporter.run({ format: "json", output: "/dev/null" });
      expect(exportService.getExport).toHaveBeenCalled();
    });
  });

  describe("serve", () => {
    let server: http.Server;
    let base: string;

    beforeEach(async () => {
      // As `serve` runs: never interactive, even from a terminal.
      terminal(true);
      process.env.BW_SERVE = "true";
      // Signed in and unlocked.
      const keyService = mock<KeyService>();
      keyService.hasUserKey.mockResolvedValue(true);
      const cipherArchiveService = mock<{ userCanArchive$: (id: string) => unknown }>();
      cipherArchiveService.userCanArchive$.mockReturnValue(of(false));
      const services: Record<string, unknown> = {
        keyService,
        cipherArchiveService,
        cipherService,
        totpService,
        auditService,
        accountService,
        billingAccountProfileStateService: profile,
        cliRestrictedItemTypesService: restricted,
        searchService: mock<SearchService>(),
      };
      const container = new Proxy(services, {
        get: (target, name: string) => (name in target ? target[name] : (target[name] = mock())),
      }) as unknown as ServiceContainer;
      const router = new Router();
      await new OssServeConfigurator(container).configureRouter(router);
      const app = new koa();
      app.use(koaBodyParser()).use(router.routes()).use(router.allowedMethods());
      server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
      delete process.env.BW_SERVE;
      await new Promise((resolve) => server.close(resolve));
    });

    async function call(path: string): Promise<{ status: number; body: any }> {
      return await new Promise((resolve, reject) => {
        http
          .get(`${base}${path}`, { headers: { Host: new URL(base).host } }, (res) => {
            let text = "";
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
          })
          .on("error", reject);
      });
    }

    it.each(["password", "totp", "notes", "exposed", "item"])(
      "refuses GET /object/%s for such an item, and never asks",
      async (object) => {
        const answer = await call(`/object/${object}/${ID}`);
        expect(answer.status).toBe(400);
        expect(answer.body.message).toBe(serveRefusal());
        expect(prompted).toEqual([]);
      },
    );

    it("can't be approved by a request", async () => {
      for (const query of ["reprompt-ok=true", "repromptOk=true", "reprompt_ok=1"]) {
        const answer = await call(`/object/password/${ID}?${query}`);
        expect(answer.body.message).toBe(serveRefusal());
      }
    });

    it("gives the plain values in GET /list/object/items", async () => {
      cipherService.getAllDecrypted.mockResolvedValue([item]);
      restricted.filterRestrictedCiphers.mockImplementation(async (c) => c);
      const answer = await call("/list/object/items");
      expect(answer.status).toBe(200);
      const [listed] = answer.body.data.data;
      expect(listed.name).toBe("Domain admin");
      expect(listed.login.username).toBe("administrator");
      expect(listed.login.password).toBeNull();
      expect(listed.notes).toBeNull();
    });

    it("gives them when serve was started with --reprompt-ok", async () => {
      approveReprompted();
      const answer = await call(`/object/password/${ID}`);
      expect(answer.status).toBe(200);
      expect(answer.body.data.data).toBe("real-password");
    });
  });
});
