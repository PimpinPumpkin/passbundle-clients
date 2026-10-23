import { CipherRepromptType, CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { AttachmentView } from "@bitwarden/common/vault/models/view/attachment.view";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { Fido2CredentialView } from "@bitwarden/common/vault/models/view/fido2-credential.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import {
  distinctVersions,
  restoredView,
  sameFields,
  savedByLabel,
  versionRows,
} from "./item-versions";

/** Reads translations back as their keys and arguments, so tests see which. */
const t = (key: string, ...args: (string | number)[]) =>
  args.length ? `${key}(${args.join(",")})` : key;

function field(name: string, value: string, type: FieldType = FieldType.Text) {
  const f = new FieldView();
  f.name = name;
  f.value = value;
  f.type = type;
  return f;
}

function login(password: string, overrides: Partial<CipherView> = {}) {
  const item = new CipherView();
  item.id = "item-1";
  item.type = CipherType.Login;
  item.name = "Mail";
  item.login = new LoginView();
  item.login.username = "ana@example.test";
  item.login.password = password;
  const uri = new LoginUriView();
  uri.uri = "https://mail.example.test";
  item.login.uris = [uri];
  return Object.assign(item, overrides);
}

const byKey = (rows: ReturnType<typeof versionRows>) => new Map(rows.map((r) => [r.key, r]));

describe("versionRows", () => {
  it("puts a version next to the item now and marks what changed", () => {
    const rows = versionRows(login("first"), login("second"), t);
    expect(rows.map((r) => [r.label, r.version, r.current, r.changed])).toEqual([
      ["itemName", "Mail", "Mail", false],
      ["username", "ana@example.test", "ana@example.test", false],
      ["password", "first", "second", true],
      ["website", "https://mail.example.test", "https://mail.example.test", false],
    ]);
    // Passwords stay hidden until shown.
    expect(rows.filter((r) => r.secret).map((r) => r.key)).toEqual(["login.password"]);
  });

  it("leaves out what neither has, and the type and re-prompt unless they changed", () => {
    const rows = byKey(versionRows(login("same"), login("same"), t));
    expect(rows.has("type")).toBe(false);
    expect(rows.has("reprompt")).toBe(false);
    expect(rows.has("login.totp")).toBe(false);
    expect(rows.has("notes")).toBe(false);

    const asked = login("same", { reprompt: CipherRepromptType.Password });
    expect(byKey(versionRows(login("same"), asked, t)).get("reprompt")).toMatchObject({
      label: "passwordPrompt",
      version: "off",
      current: "on",
      changed: true,
    });
  });

  it("shows what only one of them has: a website added, notes removed", () => {
    const now = login("same");
    const second = new LoginUriView();
    second.uri = "https://webmail.example.test";
    now.login.uris = [...now.login.uris, second];
    const rows = byKey(versionRows(login("same", { notes: "old note" }), now, t));
    expect(rows.get("login.uri.1")).toMatchObject({
      version: "",
      current: "https://webmail.example.test",
      changed: true,
    });
    expect(rows.get("notes")).toMatchObject({ version: "old note", current: "", changed: true });
  });

  it("compares custom fields by name, hides hidden ones, and keeps our own fields out of them", () => {
    const version = login("same", {
      fields: [
        field("Hostname", "db1.example.test"),
        field("Root password", "old-root", FieldType.Hidden),
        field("Production", "true", FieldType.Boolean),
        field("keykeeper.expires", "2026-11-01"),
        field("keykeeper.template", '{"id":"server"}'),
      ],
    });
    const current = login("same", {
      fields: [
        field("Hostname", "db2.example.test"),
        field("Root password", "old-root", FieldType.Hidden),
        field("Production", "false", FieldType.Boolean),
        field("keykeeper.expires", "2027-11-01"),
        field("keykeeper.template", '{"id":"server"}'),
      ],
    });
    const rows = versionRows(version, current, t);
    const map = byKey(rows);
    expect(map.get("field.Hostname.0")).toMatchObject({
      label: "Hostname",
      changed: true,
      secret: false,
    });
    expect(map.get("field.Root password.0")).toMatchObject({ changed: false, secret: true });
    expect(map.get("field.Production.0")).toMatchObject({
      version: "yes",
      current: "no",
      changed: true,
    });
    // The expiration date is its own row; our other fields aren't shown.
    expect(map.get("expires")).toMatchObject({
      label: "keykeeperExpires",
      version: "2026-11-01",
      current: "2027-11-01",
    });
    expect(rows.some((r) => r.label.startsWith("keykeeper."))).toBe(false);
  });

  it("tells fields with the same name apart by their place", () => {
    const version = login("same", { fields: [field("PIN", "1111"), field("PIN", "2222")] });
    const current = login("same", { fields: [field("PIN", "1111"), field("PIN", "3333")] });
    const map = byKey(versionRows(version, current, t));
    expect(map.get("field.PIN.0")?.changed).toBe(false);
    expect(map.get("field.PIN.1")).toMatchObject({
      version: "2222",
      current: "3333",
      changed: true,
    });
  });

  it("shows a change of type, with each type's own fields", () => {
    const note = new CipherView();
    note.type = CipherType.SecureNote;
    note.name = "Mail";
    note.notes = "pin 1234";
    const rows = byKey(versionRows(note, login("pw"), t));
    expect(rows.get("type")).toMatchObject({
      version: "typeSecureNote",
      current: "typeLogin",
      changed: true,
    });
    expect(rows.get("login.password")).toMatchObject({ version: "", current: "pw", changed: true });
  });

  it("marks a card's number and code as hidden, and reads its expiration as one field", () => {
    const card = (number: string) => {
      const item = new CipherView();
      item.type = CipherType.Card;
      item.name = "Visa";
      item.card = new CardView();
      item.card.number = number;
      item.card.code = "123";
      item.card.expMonth = "4";
      item.card.expYear = "2030";
      return item;
    };
    const map = byKey(versionRows(card("4111111111111111"), card("4000056655665556"), t));
    expect(map.get("card.number")).toMatchObject({ secret: true, changed: true });
    expect(map.get("card.code")).toMatchObject({ secret: true, changed: false });
    expect(map.get("card.expiration")).toMatchObject({ version: "4 / 2030", changed: false });
  });

  it("tells passkeys apart by their credential, not by the site's name", () => {
    const passkey = (id: string) => {
      const p = new Fido2CredentialView();
      p.credentialId = id;
      p.rpId = "example.test";
      p.userName = "ana";
      return p;
    };
    const version = login("same");
    version.login.fido2Credentials = [passkey("old-credential")];
    const current = login("same");
    current.login.fido2Credentials = [passkey("new-credential")];
    expect(byKey(versionRows(version, current, t)).get("login.passkey.0")).toMatchObject({
      label: "typePasskey",
      version: "example.test, ana",
      current: "example.test, ana",
      changed: true,
    });
  });
});

describe("distinctVersions", () => {
  it("lists only versions that look different from the one after them", () => {
    // Newest first. A favorite toggled in the web vault saves the item again
    // unchanged, so the server keeps a version that looks like the next.
    const current = login("three");
    const versions = [
      { id: "favorited", view: login("three") },
      { id: "two", view: login("two") },
      { id: "two-again", view: login("two") },
      { id: "one", view: login("one") },
    ];
    expect(distinctVersions(versions, current).map((v) => v.id)).toEqual(["two", "one"]);
    expect(sameFields(login("one"), login("one", { favorite: true, folderId: "folder" }))).toBe(
      true,
    );
  });
});

describe("restoredView", () => {
  it("takes the version's contents and keeps what versions don't carry", () => {
    const attachment = new AttachmentView();
    attachment.id = "file-1";
    const current = login("now", {
      organizationId: "org-1",
      folderId: "folder-1",
      favorite: true,
      collectionIds: ["collection-1"],
      attachments: [attachment],
      revisionDate: new Date("2026-10-23T10:00:00Z"),
      edit: true,
    });
    const version = login("then", {
      name: "Old mail",
      notes: "old note",
      fields: [field("Hostname", "db1.example.test")],
      reprompt: CipherRepromptType.Password,
      revisionDate: new Date("2026-10-01T10:00:00Z"),
      edit: false,
    });

    const restored = restoredView(version, current);
    expect(restored).toBeInstanceOf(CipherView);
    expect(restored).not.toBe(current);
    expect(restored.login.password).toBe("then");
    expect(restored.name).toBe("Old mail");
    expect(restored.notes).toBe("old note");
    expect(restored.fields.map((f) => f.value)).toEqual(["db1.example.test"]);
    expect(restored.reprompt).toBe(CipherRepromptType.Password);
    expect(restored).toMatchObject({
      id: "item-1",
      organizationId: "org-1",
      folderId: "folder-1",
      favorite: true,
      collectionIds: ["collection-1"],
      attachments: [attachment],
      edit: true,
    });
    // An edit of the item as it is now, so the server takes it.
    expect(restored.revisionDate).toEqual(current.revisionDate);
    // The item now is untouched until the restore saves.
    expect(current.login.password).toBe("now");
    expect(sameFields(restored, version)).toBe(true);
  });
});

describe("savedByLabel", () => {
  it("names who saved a version as far as the server says", () => {
    const ana = { id: "ana-id", name: "Ana", email: "ana@example.test" };
    expect(savedByLabel(ana, "ana-id", t)).toBe("keykeeperSavedByYou");
    expect(savedByLabel(ana, "ben-id", t)).toBe("keykeeperSavedBy(Ana)");
    expect(savedByLabel({ ...ana, name: null }, "ben-id", t)).toBe(
      "keykeeperSavedBy(ana@example.test)",
    );
    expect(savedByLabel({ id: null, name: null, email: null }, "ben-id", t)).toBe(
      "keykeeperSavedByAnotherMember",
    );
    expect(savedByLabel(null, "ben-id", t)).toBeNull();
  });
});
