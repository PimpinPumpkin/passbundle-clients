// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// Keykeeper: `get` for items whose secrets the person can't see
// (hidden-items.ts), item templates (templates.ts), and item history
// (item-history.ts), through upstream's GetCommand.
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { CollectionService } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { SearchService } from "@bitwarden/common/vault/abstractions/search.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { TEMPLATE_FIELD_NAME } from "@bitwarden/common/vault/keykeeper/templates";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { KeyService } from "@bitwarden/key-management";

import { GetCommand } from "../commands/get.command";
import { ListResponse } from "../models/response/list.response";
import { StringResponse } from "../models/response/string.response";
import { TemplateResponse } from "../models/response/template.response";
import { CipherResponse } from "../vault/models/cipher.response";
import { CliRestrictedItemTypesService } from "../vault/services/cli-restricted-item-types.service";

import { HIDDEN_SECRETS_MESSAGE } from "./hidden-items";

const ID = "11111111-1111-1111-1111-111111111111";

function login(viewPassword: boolean) {
  const item = new CipherView();
  item.id = ID;
  item.organizationId = "22222222-2222-2222-2222-222222222222";
  item.type = CipherType.Login;
  item.name = "Domain admin";
  item.viewPassword = viewPassword;
  item.login.username = "admin@contoso.example";
  item.login.password = "real-password";
  item.login.totp = "JBSWY3DPEHPK3PXP";
  return item;
}

describe("GetCommand with PassBundle's rules", () => {
  const cipherService = mock<CipherService>();
  const totpService = mock<TotpService>();
  const auditService = mock<AuditService>();
  const apiService = mock<ApiService>();
  const organizationService = mock<OrganizationService>();
  const accountService = mock<AccountService>();
  const accountProfileService = mock<BillingAccountProfileStateService>();
  const restricted = mock<CliRestrictedItemTypesService>();
  const userId = "user-id" as UserId;

  let command: GetCommand;
  let item: CipherView;

  beforeEach(() => {
    jest.resetAllMocks();
    accountService.activeAccount$ = of({
      id: userId,
      ...mockAccountInfoWith({ email: "ana@contoso.example", name: "Ana" }),
    });
    accountProfileService.hasPremiumFromAnySource$.mockReturnValue(of(true));
    restricted.isCipherRestricted.mockResolvedValue(false);
    cipherService.get.mockImplementation(async () => ({ id: ID }) as Cipher);
    cipherService.decrypt.mockImplementation(async () => item);
    totpService.getCode$.mockReturnValue(of({ code: "123456", period: 30 }));
    auditService.passwordLeaked.mockResolvedValue(3);
    organizationService.memberOrganizations$.mockReturnValue(of([]));
    command = new GetCommand(
      cipherService,
      mock<FolderService>(),
      mock<CollectionService>(),
      totpService,
      auditService,
      mock<KeyService>(),
      mock<EncryptService>(),
      mock<SearchService>(),
      apiService,
      organizationService,
      mock<EventCollectionService>(),
      accountProfileService,
      accountService,
      restricted,
      mock<ConfigService>(),
    );
  });

  it.each(["password", "totp", "exposed"])(
    "refuses `get %s` for an item whose secrets the person can't see",
    async (object) => {
      item = login(false);
      const response = await command.run(object, ID, {});
      expect(response.success).toBe(false);
      expect(response.message).toBe(HIDDEN_SECRETS_MESSAGE);
      expect(auditService.passwordLeaked).not.toHaveBeenCalled();
      expect(totpService.getCode$).not.toHaveBeenCalled();
    },
  );

  it("answers them for an item whose secrets the person can see", async () => {
    item = login(true);
    expect(((await command.run("password", ID, {})).data as StringResponse).data).toBe(
      "real-password",
    );
    expect(((await command.run("totp", ID, {})).data as StringResponse).data).toBe("123456");
    expect(((await command.run("exposed", ID, {})).data as StringResponse).data).toBe("3");
  });

  it("gives a hidden item's plain values: its username, and the item without its secrets", async () => {
    item = login(false);
    expect(((await command.run("username", ID, {})).data as StringResponse).data).toBe(
      "admin@contoso.example",
    );
    const shown = (await command.run("item", ID, {})).data as CipherResponse;
    expect(shown.login.username).toBe("admin@contoso.example");
    expect(JSON.stringify(shown)).not.toContain("real-password");
    expect(JSON.stringify(shown)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("makes a new item from a built-in template, and keeps upstream's JSON templates", async () => {
    cipherService.getAllDecrypted.mockResolvedValue([]);
    const fromTemplate = (await command.run("template", "Wi-Fi network", {}))
      .data as TemplateResponse;
    expect(fromTemplate.template.type).toBe(CipherType.SecureNote);
    expect(fromTemplate.template.fields.map((f: any) => f.name)).toEqual([
      "Network name",
      "Password",
      "Security type",
      TEMPLATE_FIELD_NAME,
    ]);
    const upstream = (await command.run("template", "item", {})).data as TemplateResponse;
    expect(upstream.template.name).toBe("Item name");
    const unknown = await command.run("template", "no-such-template", {});
    expect(unknown.success).toBe(false);
    expect(unknown.message).toContain("list templates");
  });

  it("lists an item's history, and says so when the server won't show it", async () => {
    item = login(true);
    apiService.send.mockResolvedValue({ hidePasswords: true, data: [] });
    const history = await command.run("history", ID, {});
    expect(history.success).toBe(true);
    expect((history.data as ListResponse).data).toEqual([]);

    apiService.send.mockRejectedValue(new ErrorResponse({}, 404));
    const refused = await command.run("history", ID, {});
    expect(refused.success).toBe(false);
    expect(refused.message).toBe("You can't see this item's history.");
  });
});
