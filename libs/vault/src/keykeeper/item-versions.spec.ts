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
  droppedPasskeys,
  historyAccess,
  restoreConfirmation,
  restoredView,
  sameFields,
  savedByLabel,
  versionRows,
  versionTime,
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
      version: "keykeeperOff",
      current: "keykeeperOn",
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
  it("keeps the oldest of each run that looks the same, so its author is who wrote it", () => {
    // Newest first. An app that saves the whole item to toggle a favorite
    // makes the server keep a version that looks like the one before it.
    const current = login("three");
    const versions = [
      { id: "favorited-now", view: login("three") },
      { id: "two-favorited", view: login("two") },
      { id: "two-written", view: login("two") },
      { id: "one", view: login("one") },
    ];
    expect(distinctVersions(versions, current).map((v) => v.id)).toEqual(["two-written", "one"]);
    expect(sameFields(login("one"), login("one", { favorite: true, folderId: "folder" }))).toBe(
      true,
    );
  });

  it("still lists an old version that looks like the item now, as after restoring it", () => {
    const current = login("one");
    const versions = [
      { id: "three", view: login("three") },
      { id: "two", view: login("two") },
      { id: "one", view: login("one") },
    ];
    expect(distinctVersions(versions, current).map((v) => v.id)).toEqual(["three", "two", "one"]);
    expect(distinctVersions([], current)).toEqual([]);
  });
});

describe("restoredView", () => {
  it("keeps PassBundle's own fields as they are now, never the version's", () => {
    const rule = (host: string) =>
      field(
        "keykeeper.fill",
        JSON.stringify({ v: 1, host, field: { id: "pw" }, fill: { from: "password" } }),
        FieldType.Hidden,
      );
    const current = login("now", {
      fields: [field("Hostname", "db2.example.test"), field("keykeeper.expires", "2027-01-01")],
    });
    // An older version had a fill rule since removed, a template marker, and another expiry.
    const version = login("then", {
      fields: [
        field("Hostname", "db1.example.test"),
        rule("old.example.test"),
        field("keykeeper.template-definition", '{"id":"t1","base":"note","v":1,"from":"X"}'),
        field("keykeeper.expires", "2026-01-01"),
      ],
    });

    const restored = restoredView(version, current);
    expect(restored.fields.map((f) => [f.name, f.value])).toEqual([
      ["Hostname", "db1.example.test"],
      ["keykeeper.expires", "2027-01-01"],
    ]);
  });

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

function passkey(credentialId: string, counter: number, rpId = "shop.example.test") {
  const p = new Fido2CredentialView();
  p.credentialId = credentialId;
  p.counter = counter;
  p.rpId = rpId;
  p.userName = "ana";
  p.keyValue = `key-${credentialId}-${counter}`;
  return p;
}

describe("restoring passkeys, as the apps do", () => {
  it("keeps each passkey the item still has as it is now, with its raised counter", () => {
    const version = login("old");
    version.login.fido2Credentials = [passkey("pk-1", 3)];
    const current = login("new", { revisionDate: new Date("2026-10-26T10:00:00Z") });
    current.login.fido2Credentials = [passkey("pk-1", 9)];

    const restored = restoredView(version, current);
    expect(restored.login.password).toBe("old");
    expect(restored.login.fido2Credentials.map((p) => [p.credentialId, p.counter])).toEqual([
      ["pk-1", 9],
    ]);
    // The save names the revision it replaces, so it can't overwrite a newer edit.
    expect(restored.revisionDate).toEqual(current.revisionDate);
    // The version itself is left as it was.
    expect(version.login.fido2Credentials[0].counter).toBe(3);
  });

  it("brings back a passkey the item no longer has, and keeps the version's when its counter is ahead", () => {
    const version = login("old");
    version.login.fido2Credentials = [passkey("pk-gone", 2), passkey("pk-ahead", 7)];
    const current = login("new");
    current.login.fido2Credentials = [passkey("pk-ahead", 5)];
    const restored = restoredView(version, current);
    expect(restored.login.fido2Credentials.map((p) => [p.credentialId, p.counter])).toEqual([
      ["pk-gone", 2],
      ["pk-ahead", 7],
    ]);
  });

  it("names the passkeys a version would take away, by credential", () => {
    const version = login("old");
    version.login.fido2Credentials = [passkey("pk-1", 1)];
    const current = login("new");
    current.login.fido2Credentials = [passkey("pk-1", 4), passkey("pk-2", 1, "mail.example.test")];
    expect(droppedPasskeys(version, current)).toEqual(["mail.example.test, ana"]);
    expect(droppedPasskeys(current, version)).toEqual([]);
  });

  it("asks before restoring, and says which passkeys go", () => {
    const version = login("old");
    const current = login("new");
    expect(restoreConfirmation(version, current, "then")).toMatchObject({
      content: { key: "keykeeperRestoreVersionDesc", placeholders: ["then"] },
      acceptButtonText: { key: "keykeeperRestoreVersion" },
    });

    current.login.fido2Credentials = [passkey("pk-1", 1)];
    expect(restoreConfirmation(version, current, "then")).toMatchObject({
      content: {
        key: "keykeeperRestoreVersionDropsPasskey",
        placeholders: ["then", "shop.example.test, ana"],
      },
      acceptButtonText: { key: "keykeeperRestoreAnyway" },
    });

    current.login.fido2Credentials = [passkey("pk-1", 1), passkey("pk-2", 1, "mail.example.test")];
    expect(restoreConfirmation(version, current, "then").content).toEqual({
      key: "keykeeperRestoreVersionDropsPasskeys",
      placeholders: ["then", "2", "shop.example.test, ana; mail.example.test, ana"],
    });
  });
});

describe("historyAccess", () => {
  const folder = (id: string, keykeeper: Record<string, boolean>) => ({
    id,
    organizationId: "org",
    readOnly: false,
    hidePasswords: false,
    manage: false,
    keykeeper: {
      seePasswords: false,
      create: false,
      edit: false,
      delete: false,
      export: false,
      share: false,
      print: false,
      viewHistory: false,
      manage: false,
      ...keykeeper,
    },
  });
  const item = { organizationId: "org", collectionIds: ["a", "b"] };

  it("gives the person everything with their own item, or one they reach as an admin", () => {
    expect(historyAccess({ organizationId: null }, [])).toEqual({
      view: true,
      contents: true,
      clear: true,
    });
    expect(historyAccess({ organizationId: "org", collectionIds: [] }, [], true).clear).toBe(true);
  });

  it("shows the history with view item history in one of the item's shared folders", () => {
    expect(historyAccess(item, [folder("a", { seePasswords: true })]).view).toBe(false);
    expect(historyAccess(item, [folder("a", { viewHistory: true })])).toEqual({
      view: true,
      contents: false,
      clear: false,
    });
    // A folder the item isn't in doesn't count.
    expect(historyAccess(item, [folder("c", { viewHistory: true, delete: true })]).view).toBe(
      false,
    );
  });

  it("needs both of each pair in the same folder, never one from each of two", () => {
    const split = [
      folder("a", { viewHistory: true }),
      folder("b", { seePasswords: true, delete: true }),
    ];
    expect(historyAccess(item, split)).toEqual({ view: true, contents: false, clear: false });

    const together = [folder("a", { viewHistory: true, seePasswords: true, delete: true })];
    expect(historyAccess(item, together)).toEqual({ view: true, contents: true, clear: true });
  });

  it("reads upstream's presets for a folder the server sent no grid for", () => {
    const preset = {
      id: "a",
      organizationId: "org",
      readOnly: true,
      hidePasswords: true,
      manage: false,
    };
    expect(historyAccess(item, [preset])).toEqual({ view: true, contents: false, clear: false });
  });
});

describe("versionTime", () => {
  it("shows a short date and time, without seconds, with a space before AM", () => {
    expect(versionTime(new Date(2026, 9, 27, 1, 15, 36), "en-US")).toBe("Oct 27, 2026, 1:15 AM");
    expect(versionTime(new Date(2026, 9, 27, 13, 5), "en-US")).toBe("Oct 27, 2026, 1:05 PM");
  });
});
