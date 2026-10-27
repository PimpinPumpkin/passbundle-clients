// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// Keykeeper: every kind of item, through every way the tool shows items
// (`get item`, `list items`, and `serve`, which runs the same commands), for
// someone who can't see the item's passwords: each value the shared allowlist
// (libs/common/src/vault/keykeeper/hidden-secrets.ts) calls a secret is gone,
// and each plain one is there. Driven by the allowlist itself, so a value of
// a new kind is checked as soon as it's listed.
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { CollectionService, OrganizationUserApiService } from "@bitwarden/admin-console/common";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AuditService } from "@bitwarden/common/abstractions/audit.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { EventCollectionService } from "@bitwarden/common/dirt/event-logs";
import { EncryptService } from "@bitwarden/common/key-management/crypto/abstractions/encrypt.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { mockAccountInfoWith } from "@bitwarden/common/spec";
import { UserId } from "@bitwarden/common/types/guid";
import { CipherArchiveService } from "@bitwarden/common/vault/abstractions/cipher-archive.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { FolderService } from "@bitwarden/common/vault/abstractions/folder/folder.service.abstraction";
import { SearchService } from "@bitwarden/common/vault/abstractions/search.service";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import {
  isSecretValue,
  ITEM_VALUES,
  ItemValuePart,
} from "@bitwarden/common/vault/keykeeper/hidden-secrets";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { AttachmentView } from "@bitwarden/common/vault/models/view/attachment.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { Fido2CredentialView } from "@bitwarden/common/vault/models/view/fido2-credential.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";
import { KeyService } from "@bitwarden/key-management";

import { GetCommand } from "../commands/get.command";
import { ListCommand } from "../commands/list.command";
import { CipherResponse } from "../vault/models/cipher.response";
import { CliRestrictedItemTypesService } from "../vault/services/cli-restricted-item-types.service";

const ID = "11111111-1111-1111-1111-111111111111";

/** Each kind of item, and the part of it that holds its values (a note has none). */
const KINDS: [string, CipherType, ItemValuePart | null][] = [
  ["login", CipherType.Login, "login"],
  ["secure note", CipherType.SecureNote, null],
  ["card", CipherType.Card, "card"],
  ["identity", CipherType.Identity, "identity"],
  ["SSH key", CipherType.SshKey, "sshKey"],
  ["bank account", CipherType.BankAccount, "bankAccount"],
  ["driver's license", CipherType.DriversLicense, "driversLicense"],
  ["passport", CipherType.Passport, "passport"],
];

const mark = (part: string, property: string) =>
  `${isSecretValue(`${part}.${property}`) ? "SECRET" : "plain"}-${part}-${property}`;

/** An item of this kind, every value set to a marker that says whether it's a secret. */
function item(type: CipherType, part: ItemValuePart | null, viewPassword: boolean): CipherView {
  const view = new CipherView();
  view.id = ID;
  view.organizationId = "22222222-2222-2222-2222-222222222222";
  view.collectionIds = ["33333333-3333-3333-3333-333333333333"];
  view.type = type;
  view.name = "plain-name";
  view.notes = "plain-notes";
  view.viewPassword = viewPassword;
  if (part != null) {
    for (const property of ITEM_VALUES[part]) {
      (view[part] as unknown as Record<string, string>)[property] = mark(part, property);
    }
  }
  if (type === CipherType.Login) {
    view.login.fido2Credentials = [
      Object.assign(new Fido2CredentialView(), {
        credentialId: "SECRET-passkey-id",
        keyValue: "SECRET-passkey-key",
      }),
    ];
  }
  view.passwordHistory = [
    Object.assign(new PasswordHistoryView(), { password: "SECRET-password-history" }),
  ];
  view.fields = [
    Object.assign(new FieldView(), {
      name: "Hidden",
      type: FieldType.Hidden,
      value: "SECRET-hidden-field",
    }),
    Object.assign(new FieldView(), {
      name: "Text",
      type: FieldType.Text,
      value: "plain-text-field",
    }),
  ];
  view.attachments = [
    Object.assign(new AttachmentView(), { id: "a1", fileName: "plain-attachment.pdf" }),
  ];
  return view;
}

/** Every plain value an item of this kind has, as its marker. */
function plainMarkers(part: ItemValuePart | null): string[] {
  const markers = ["plain-name", "plain-notes", "plain-text-field", "plain-attachment.pdf"];
  if (part != null) {
    markers.push(
      ...ITEM_VALUES[part]
        .filter((property) => !isSecretValue(`${part}.${property}`))
        .map((property) => mark(part, property)),
    );
  }
  return markers;
}

describe("every kind of item, for someone who can't see its passwords", () => {
  const cipherService = mock<CipherService>();
  const accountService = mock<AccountService>();
  const organizationService = mock<OrganizationService>();
  const restricted = mock<CliRestrictedItemTypesService>();
  const searchService = mock<SearchService>();
  let get: GetCommand;
  let list: ListCommand;
  let shown: CipherView;

  beforeEach(() => {
    jest.resetAllMocks();
    accountService.activeAccount$ = of({
      id: "user-id" as UserId,
      ...mockAccountInfoWith({ email: "ana@contoso.example", name: "Ana" }),
    });
    restricted.isCipherRestricted.mockResolvedValue(false);
    restricted.filterRestrictedCiphers.mockImplementation(async (c) => c);
    cipherService.get.mockImplementation(async () => ({ id: ID }) as Cipher);
    cipherService.decrypt.mockImplementation(async () => shown);
    cipherService.getAllDecrypted.mockImplementation(async () => [shown]);
    organizationService.memberOrganizations$.mockReturnValue(of([]));
    const archive = mock<CipherArchiveService>();
    archive.userCanArchive$.mockReturnValue(of(false));
    get = new GetCommand(
      cipherService,
      mock<FolderService>(),
      mock<CollectionService>(),
      mock<TotpService>(),
      mock<AuditService>(),
      mock<KeyService>(),
      mock<EncryptService>(),
      searchService,
      mock<ApiService>(),
      organizationService,
      mock<EventCollectionService>(),
      mock<BillingAccountProfileStateService>(),
      accountService,
      restricted,
      mock<ConfigService>(),
    );
    list = new ListCommand(
      cipherService,
      mock<FolderService>(),
      mock<CollectionService>(),
      organizationService,
      searchService,
      mock<OrganizationUserApiService>(),
      mock<ApiService>(),
      mock<EventCollectionService>(),
      accountService,
      mock<KeyService>(),
      restricted,
      archive,
    );
  });

  describe.each(KINDS)("a %s", (_, type, part) => {
    it("shows only its plain values in CipherResponse, which every command uses", () => {
      const json = JSON.stringify(new CipherResponse(item(type, part, false)));
      expect(json).not.toContain("SECRET");
      for (const marker of plainMarkers(part)) {
        expect(json).toContain(marker);
      }
    });

    it("shows only its plain values from `get item` and `list items`", async () => {
      shown = item(type, part, false);
      const got = await get.run("item", ID, {});
      expect(got.success).toBe(true);
      const listed = await list.run("items", {});
      expect(listed.success).toBe(true);
      for (const response of [got, listed]) {
        const json = JSON.stringify(response.data);
        expect(json).not.toContain("SECRET");
        for (const marker of plainMarkers(part)) {
          expect(json).toContain(marker);
        }
      }
    });

    it("shows everything to someone who can see its passwords", () => {
      const json = JSON.stringify(new CipherResponse(item(type, part, true)));
      expect(json).toContain("SECRET-hidden-field");
      if (part != null) {
        for (const property of ITEM_VALUES[part]) {
          expect(json).toContain(mark(part, property));
        }
      }
    });
  });

  it("covers every kind the allowlist knows", () => {
    expect(KINDS.map(([, , part]) => part).filter((p) => p != null)).toEqual(
      expect.arrayContaining(Object.keys(ITEM_VALUES)),
    );
  });
});
