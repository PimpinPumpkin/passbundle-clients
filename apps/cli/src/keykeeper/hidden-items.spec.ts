// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// Keykeeper: see hidden-items.ts.
import { CipherExport } from "@bitwarden/common/models/export/cipher.export";
import { CipherType, FieldType, LoginLinkedId } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { Fido2CredentialView } from "@bitwarden/common/vault/models/view/fido2-credential.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";

import { CipherResponse } from "../vault/models/cipher.response";

import {
  fillHiddenSshKey,
  hiddenSecretsOf,
  itemWithoutSecrets,
  keepHiddenSecrets,
  refuseSentSecrets,
} from "./hidden-items";

const field = (name: string, type: FieldType, value: string | null, linkedId?: number) =>
  Object.assign(new FieldView(), { name, type, value, linkedId });

/** A login with every kind of secret a login can have, seen as `viewPassword` says. */
function login(viewPassword: boolean | undefined): CipherView {
  const item = new CipherView();
  item.id = "11111111-1111-1111-1111-111111111111";
  item.organizationId = "22222222-2222-2222-2222-222222222222";
  item.collectionIds = ["33333333-3333-3333-3333-333333333333"];
  item.type = CipherType.Login;
  item.name = "Domain admin";
  item.notes = "Ask before rotating.";
  item.viewPassword = viewPassword;
  item.login.username = "admin@contoso.example";
  item.login.password = "real-password";
  item.login.totp = "JBSWY3DPEHPK3PXP";
  item.login.uris = [Object.assign(new LoginUriView(), { uri: "https://contoso.example" })];
  item.login.fido2Credentials = [
    Object.assign(new Fido2CredentialView(), { credentialId: "pk-1", keyValue: "pk-private" }),
  ];
  item.passwordHistory = [Object.assign(new PasswordHistoryView(), { password: "old-password" })];
  item.fields = [
    field("API key", FieldType.Hidden, "k-123"),
    field("Ticket", FieldType.Text, "IT-42"),
    field("Fills the password", FieldType.Linked, null, LoginLinkedId.Password),
    field("Fills the username", FieldType.Linked, null, LoginLinkedId.Username),
  ];
  return item;
}

describe("CipherResponse for someone who can't see an item's passwords", () => {
  it.each([false, undefined, null])(
    "shows only plain values when viewPassword is %s",
    (viewPassword) => {
      const json = JSON.parse(JSON.stringify(new CipherResponse(login(viewPassword as any))));
      expect(json.id).toBe("11111111-1111-1111-1111-111111111111");
      expect(json.name).toBe("Domain admin");
      expect(json.notes).toBe("Ask before rotating.");
      expect(json.collectionIds).toEqual(["33333333-3333-3333-3333-333333333333"]);
      expect(json.login.username).toBe("admin@contoso.example");
      expect(json.login.uris[0].uri).toBe("https://contoso.example");
      expect(json.login.password).toBeNull();
      expect(json.login.totp).toBeNull();
      expect(json.login.fido2Credentials ?? []).toEqual([]);
      expect(json.passwordHistory).toBeUndefined();
      expect(json.fields).toEqual([
        { name: "API key", value: null, type: FieldType.Hidden },
        { name: "Ticket", value: "IT-42", type: FieldType.Text },
        { name: "Fills the password", type: FieldType.Linked, linkedId: LoginLinkedId.Password },
        { name: "Fills the username", type: FieldType.Linked, linkedId: LoginLinkedId.Username },
      ]);
      const text = JSON.stringify(json);
      for (const secret of ["real-password", "JBSWY3DPEHPK3PXP", "k-123", "old-password"]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toContain("pk-private");
    },
  );

  it("shows everything to someone who can see the passwords", () => {
    const json = JSON.parse(JSON.stringify(new CipherResponse(login(true))));
    expect(json.login.password).toBe("real-password");
    expect(json.login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(json.fields[0].value).toBe("k-123");
    expect(json.passwordHistory[0].password).toBe("old-password");
  });

  it("masks every kind of item's secrets, and keeps its plain values", () => {
    const card = new CipherView();
    card.type = CipherType.Card;
    card.name = "Company card";
    card.viewPassword = false;
    Object.assign(card.card, {
      cardholderName: "Ana Diaz",
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "4",
      expYear: "2030",
      code: "123",
    });
    const cardJson = new CipherResponse(card).card;
    expect(cardJson).toMatchObject({ cardholderName: "Ana Diaz", brand: "Visa", expYear: "2030" });
    expect(cardJson.number).toBeFalsy();
    expect(cardJson.code).toBeFalsy();

    const identity = new CipherView();
    identity.type = CipherType.Identity;
    identity.name = "Ana";
    identity.viewPassword = false;
    Object.assign(identity.identity, {
      firstName: "Ana",
      email: "ana@contoso.example",
      ssn: "123-45-6789",
      passportNumber: "X1234567",
      licenseNumber: "D1234",
    });
    const identityJson = new CipherResponse(identity).identity;
    expect(identityJson).toMatchObject({ firstName: "Ana", email: "ana@contoso.example" });
    expect(identityJson.ssn).toBeFalsy();
    expect(identityJson.passportNumber).toBeFalsy();
    expect(identityJson.licenseNumber).toBeFalsy();

    const sshKey = new CipherView();
    sshKey.type = CipherType.SshKey;
    sshKey.name = "Deploy key";
    sshKey.viewPassword = false;
    Object.assign(sshKey.sshKey, {
      privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
      publicKey: "ssh-ed25519 AAAA",
      keyFingerprint: "SHA256:abc",
    });
    const sshJson = new CipherResponse(sshKey).sshKey;
    expect(sshJson.publicKey).toBe("ssh-ed25519 AAAA");
    expect(sshJson.keyFingerprint).toBe("SHA256:abc");
    expect(sshJson.privateKey).toBe("");
  });

  it("keeps the item's dates and attachments' names", () => {
    const item = login(false);
    item.revisionDate = new Date("2026-10-20T10:00:00Z");
    item.creationDate = new Date("2026-10-01T10:00:00Z");
    const shown = itemWithoutSecrets(item);
    expect(shown.revisionDate).toEqual(item.revisionDate);
    expect(shown.creationDate).toEqual(item.creationDate);
    expect(shown.id).toBe(item.id);
  });
});

describe("keepHiddenSecrets", () => {
  /** The edit as `edit item` makes it: the request checked, then read onto the item, in place. */
  function edit(item: CipherView, change: (request: any) => void, from?: any) {
    const request = from ?? JSON.parse(JSON.stringify(new CipherResponse(item)));
    change(request);
    const sent = refuseSentSecrets(item, request);
    if (sent != null) {
      return { refused: sent, edited: item };
    }
    const kept = hiddenSecretsOf(item);
    fillHiddenSshKey(item, request);
    const edited = CipherExport.toView(request, item);
    return { refused: keepHiddenSecrets(kept, edited), edited };
  }

  it("lets someone who can see the passwords change them", () => {
    const { refused, edited } = edit(login(true), (r) => (r.login.password = "rotated"));
    expect(refused).toBeNull();
    expect(edited.login.password).toBe("rotated");
  });

  it("keeps every secret when the item comes back as get item showed it", () => {
    const { refused, edited } = edit(login(false), (r) => {
      r.name = "Domain admin (old)";
      r.notes = "Rotated by the script.";
      r.fields.reverse();
    });
    expect(refused).toBeNull();
    expect(edited.name).toBe("Domain admin (old)");
    expect(edited.notes).toBe("Rotated by the script.");
    expect(edited.login.password).toBe("real-password");
    expect(edited.login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(edited.login.fido2Credentials.map((p) => p.keyValue)).toEqual(["pk-private"]);
    expect(edited.passwordHistory.map((p) => p.password)).toEqual(["old-password"]);
    const apiKey = edited.fields.find((f) => f.name === "API key");
    expect(apiKey.value).toBe("k-123");
    const linked = edited.fields.find((f) => f.name === "Fills the password");
    expect(linked.linkedId).toBe(LoginLinkedId.Password);
  });

  it.each([
    ["the password", (r: any) => (r.login.password = "attacker-chosen"), "change its password"],
    ["the one-time code", (r: any) => (r.login.totp = "AAAA"), "change its totp"],
    [
      "a hidden field",
      (r: any) => (r.fields[0].value = "k-999"),
      'change the hidden field "API key"',
    ],
    [
      "a hidden field, by removing it",
      (r: any) => r.fields.splice(0, 1),
      'remove the hidden field "API key"',
    ],
    [
      "a hidden field, by making it text",
      (r: any) => (r.fields[0].type = FieldType.Text),
      'remove the hidden field "API key"',
    ],
    [
      "a new hidden field",
      (r: any) => r.fields.push({ name: "PIN", type: FieldType.Hidden, value: "1234" }),
      'add a hidden field ("PIN")',
    ],
    [
      "a new hidden field, sent empty",
      (r: any) => r.fields.push({ name: "PIN", type: FieldType.Hidden, value: null }),
      'add a hidden field ("PIN")',
    ],
    [
      "a new field linked to the password",
      (r: any) =>
        r.fields.push({ name: "Copy", type: FieldType.Linked, linkedId: LoginLinkedId.Password }),
      'add a hidden field ("Copy")',
    ],
    [
      "a passkey",
      (r: any) => (r.login.fido2Credentials = [{ credentialId: "mine", keyValue: "k" }]),
      "change its passkeys",
    ],
    [
      "the kind of item",
      (r: any) => ((r.type = CipherType.SecureNote), (r.secureNote = { type: 0 })),
      "change its type",
    ],
  ])("refuses changing %s", (_, change, why) => {
    const { refused } = edit(login(false), change);
    expect(refused).toContain(`so you can't ${why}`);
  });

  // Otherwise a right guess would save and a wrong one be refused: an oracle.
  it.each([
    ["the password", (r: any) => (r.login.password = "real-password"), "change its password"],
    ["the one-time code", (r: any) => (r.login.totp = "JBSWY3DPEHPK3PXP"), "change its totp"],
    [
      "a hidden field",
      (r: any) => (r.fields[0].value = "k-123"),
      'change the hidden field "API key"',
    ],
  ])(
    "refuses %s sent with its right value too, so an edit can't check guesses",
    (_, change, why) => {
      const { refused } = edit(login(false), change);
      expect(refused).toContain(`so you can't ${why}`);
    },
  );

  it("takes a request with only some of the item, keeping its passkeys and key", () => {
    const item = login(false);
    item.key = { encryptedString: "2.item-key" } as any;
    const { refused, edited } = edit(item, () => {}, { type: CipherType.Login, name: "Renamed" });
    expect(refused).toBeNull();
    expect(edited.name).toBe("Renamed");
    expect(edited.login.password).toBe("real-password");
    expect(edited.login.fido2Credentials.map((p) => p.keyValue)).toEqual(["pk-private"]);
    expect(edited.key).toEqual({ encryptedString: "2.item-key" });
    expect(edited.fields.find((f) => f.name === "API key").value).toBe("k-123");
  });

  it("gives the item's own key, wrapped, so an edit sends it back", () => {
    const item = login(false);
    item.key = { encryptedString: "2.item-key" } as any;
    expect(new CipherResponse(item).key).toBe("2.item-key");
  });

  it("refuses an SSH key that isn't one, without throwing", () => {
    const key = new CipherView();
    key.type = CipherType.SshKey;
    key.viewPassword = false;
    expect(() => fillHiddenSshKey(key, { sshKey: "x" })).not.toThrow();
  });

  it("keeps a card's number and code, and refuses changing them", () => {
    const card = new CipherView();
    card.type = CipherType.Card;
    card.name = "Company card";
    card.viewPassword = false;
    Object.assign(card.card, { brand: "Visa", number: "4111111111111111", code: "123" });
    const kept = edit(card, (r) => (r.card.brand = "Mastercard"));
    expect(kept.refused).toBeNull();
    expect(kept.edited.card.number).toBe("4111111111111111");
    expect(kept.edited.card.code).toBe("123");
    expect(kept.edited.card.brand).toBe("Mastercard");

    const changed = edit(card, (r) => (r.card.number = "5555555555554444"));
    expect(changed.refused).toContain("change its number");
  });

  it("keeps an SSH key's private key, which get item shows empty", () => {
    const key = new CipherView();
    key.type = CipherType.SshKey;
    key.name = "Deploy key";
    key.viewPassword = false;
    Object.assign(key.sshKey, {
      privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
      publicKey: "ssh-ed25519 AAAA",
      keyFingerprint: "SHA256:abc",
    });
    const { refused, edited } = edit(key, (r) => (r.name = "Deploy key (prod)"));
    expect(refused).toBeNull();
    expect(edited.sshKey.privateKey).toBe("-----BEGIN OPENSSH PRIVATE KEY-----");
  });
});
