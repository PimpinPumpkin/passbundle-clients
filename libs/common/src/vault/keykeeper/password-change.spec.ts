import { UriMatchStrategy } from "../../models/domain/domain-service";
import { CipherType, FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { LoginUriView } from "../models/view/login-uri.view";
import { LoginView } from "../models/view/login.view";
import { PasswordHistoryView } from "../models/view/password-history.view";

import {
  allowedIn,
  fieldsWithMarker,
  mayChangePassword,
  newPasswordChangeMarker,
  organizationAllowsPasswordChange,
  PASSWORD_CHANGE_FIELD_NAME,
  PASSWORD_CHANGE_WINDOW_MS,
  passwordBeforeChange,
  passwordChangeWebsite,
  readPasswordChangeMarker,
  unfinishedPasswordChange,
  withChangeConfirmed,
  withChangeState,
  withNewPassword,
  withOldPasswordBack,
} from "./password-change";

const savedAt = new Date("2026-11-08T10:00:00.000Z");

function login(
  password = "old-password-1",
  websites: string[] = ["https://accounts.example.test/"],
) {
  const item = new CipherView();
  item.id = "item-1";
  item.type = CipherType.Login;
  item.edit = true;
  item.viewPassword = true;
  item.login = new LoginView();
  item.login.username = "alice";
  item.login.password = password;
  item.login.uris = websites.map((uri) => {
    const website = new LoginUriView();
    website.uri = uri;
    return website;
  });
  return item;
}

/** The item as upstream's save leaves it after a change: the new password, the old one in history at the same moment. */
function changed(state: "pending" | "refused" | "unsure" = "pending", revisedAfterMs = 40) {
  const item = withNewPassword(login(), "new-password-2", "accounts.example.test", savedAt);
  const revised = new Date(savedAt.getTime() + revisedAfterMs);
  item.login.passwordRevisionDate = revised;
  const history = new PasswordHistoryView();
  history.password = "old-password-1";
  history.lastUsedDate = revised;
  const older = new PasswordHistoryView();
  older.password = "older-password-0";
  older.lastUsedDate = new Date("2026-01-01T00:00:00.000Z");
  item.passwordHistory = [history, older];
  if (state !== "pending") {
    item.fields = fieldsWithMarker(item.fields, {
      ...readPasswordChangeMarker(item)!,
      state,
    }) as FieldView[];
  }
  return item;
}

describe("Keykeeper assisted password change: who may start one", () => {
  it("is a login the person can edit and see the password of, with a password and an https website", () => {
    expect(mayChangePassword(login())).toBe(true);
  });

  it("isn't for someone who can't edit it, or can't see its password", () => {
    const readOnly = login();
    readOnly.edit = false;
    expect(mayChangePassword(readOnly)).toBe(false);
    const hidden = login();
    hidden.viewPassword = false;
    expect(mayChangePassword(hidden)).toBe(false);
    const unsaid = login();
    unsaid.viewPassword = undefined as unknown as boolean;
    expect(mayChangePassword(unsaid)).toBe(false);
  });

  it("needs a password to give as the current one, and isn't for other kinds of items", () => {
    expect(mayChangePassword(login(""))).toBe(false);
    expect(mayChangePassword(login(null as unknown as string))).toBe(false);
    const card = login();
    card.type = CipherType.Card;
    expect(mayChangePassword(card)).toBe(false);
  });

  it("needs a website it can start from over https", () => {
    expect(mayChangePassword(login("p", ["http://printer.example.test/"]))).toBe(false);
    expect(mayChangePassword(login("p", ["ssh://server.example.test"]))).toBe(false);
    expect(mayChangePassword(login("p", []))).toBe(false);
    // Saved without a scheme, a website opens over https.
    expect(mayChangePassword(login("p", ["accounts.example.test"]))).toBe(true);
    const never = login();
    never.login.uris[0].match = UriMatchStrategy.Never;
    expect(mayChangePassword(never)).toBe(false);
    expect(
      passwordChangeWebsite(
        login("p", ["http://a.example.test", "https://b.example.test/x"]).login.uris,
      ),
    ).toBe("https://b.example.test/x");
  });

  it("isn't for an item in the trash", () => {
    const trashed = login();
    trashed.deletedDate = new Date();
    expect(mayChangePassword(trashed)).toBe(false);
  });

  it("is for an organization's item where its organization allows it, as the person's sync says", () => {
    const shared = login();
    shared.organizationId = "org-1";
    expect(
      mayChangePassword(shared, allowedIn([{ id: "org-1", keykeeperPasswordChange: true }])),
    ).toBe(true);
    // Turned off, an older server that doesn't say, or an organization the person isn't in.
    expect(
      mayChangePassword(shared, allowedIn([{ id: "org-1", keykeeperPasswordChange: false }])),
    ).toBe(false);
    expect(mayChangePassword(shared, allowedIn([{ id: "org-1" }]))).toBe(false);
    expect(
      mayChangePassword(shared, allowedIn([{ id: "org-2", keykeeperPasswordChange: true }])),
    ).toBe(false);
    expect(mayChangePassword(shared)).toBe(false);
    expect(organizationAllowsPasswordChange(null, "org-1")).toBe(false);
    // Allowed, the item's folder permissions decide, as for a personal item.
    expect(mayChangePassword(shared, () => true)).toBe(true);
    shared.edit = false;
    expect(mayChangePassword(shared, () => true)).toBe(false);
    shared.edit = true;
    shared.viewPassword = false;
    expect(mayChangePassword(shared, () => true)).toBe(false);
  });
});

describe("Keykeeper assisted password change: the item's marker", () => {
  it("is a text field holding nothing secret", () => {
    const item = withNewPassword(login(), "new-password-2", "Accounts.Example.test", savedAt);
    const field = item.fields.find((f) => f.name === PASSWORD_CHANGE_FIELD_NAME)!;
    // Text, not hidden: upstream's save adds a hidden field's old value to password history.
    expect(field.type).toBe(FieldType.Text);
    expect(JSON.parse(field.value)).toEqual({
      v: 1,
      state: "pending",
      site: "accounts.example.test",
      at: savedAt.toISOString(),
    });
    expect(field.value).not.toContain("password-");
  });

  it("sets the new password on a copy, leaving the item it came from as it was", () => {
    const item = login();
    const copy = withNewPassword(item, "new-password-2", "accounts.example.test", savedAt);
    expect(copy.login.password).toBe("new-password-2");
    expect(item.login.password).toBe("old-password-1");
    expect(item.fields ?? []).toHaveLength(0);
  });

  it("keeps the item's other fields", () => {
    const item = login();
    const other = new FieldView();
    other.name = "Customer ID";
    other.value = "123";
    item.fields = [other];
    const copy = withNewPassword(item, "n", "accounts.example.test", savedAt);
    expect(copy.fields.map((f) => f.name)).toEqual(["Customer ID", PASSWORD_CHANGE_FIELD_NAME]);
  });

  it("counts while the password is still the one the change saved", () => {
    expect(unfinishedPasswordChange(changed())?.state).toBe("pending");
    expect(unfinishedPasswordChange(changed("refused"))?.state).toBe("refused");
  });

  it("stops counting once the password changes any other way", () => {
    // Changed by hand, restored from a version, or in another app: a later revision date.
    expect(unfinishedPasswordChange(changed("pending", PASSWORD_CHANGE_WINDOW_MS + 1))).toBeNull();
    const earlier = changed();
    earlier.login.passwordRevisionDate = new Date(savedAt.getTime() - 60_000);
    expect(unfinishedPasswordChange(earlier)).toBeNull();
    const none = changed();
    none.login.passwordRevisionDate = null;
    expect(unfinishedPasswordChange(none)).toBeNull();
  });

  it("is ignored when it doesn't read cleanly", () => {
    for (const value of [
      "not json",
      JSON.stringify({ v: 2, state: "pending", site: "a.example.test", at: savedAt.toISOString() }),
      JSON.stringify({ v: 1, state: "done", site: "a.example.test", at: savedAt.toISOString() }),
      JSON.stringify({ v: 1, state: "pending", site: "<b>", at: savedAt.toISOString() }),
      JSON.stringify({ v: 1, state: "pending", site: "a.example.test", at: "yesterday" }),
      "x".repeat(2000),
    ]) {
      const item = changed();
      item.fields.find((f) => f.name === PASSWORD_CHANGE_FIELD_NAME)!.value = value;
      expect(readPasswordChangeMarker(item)).toBeNull();
      expect(unfinishedPasswordChange(item)).toBeNull();
    }
  });

  it("finds the old password: the history entry the change made", () => {
    expect(passwordBeforeChange(changed())).toBe("old-password-1");
  });

  it("finds no old password without a history entry from the change", () => {
    const item = changed();
    item.passwordHistory = item.passwordHistory.slice(1);
    expect(passwordBeforeChange(item)).toBeNull();
    expect(withOldPasswordBack(item)).toBeNull();
  });

  it("puts the old password back without the marker", () => {
    const item = changed("refused");
    const back = withOldPasswordBack(item)!;
    expect(back.login.password).toBe("old-password-1");
    expect(back.fields.some((f) => f.name === PASSWORD_CHANGE_FIELD_NAME)).toBe(false);
    // The item shown is left alone until the save succeeds.
    expect(item.login.password).toBe("new-password-2");
    expect(unfinishedPasswordChange(item)).not.toBeNull();
  });

  it("takes the marker off when it worked, keeping the new password", () => {
    const confirmed = withChangeConfirmed(changed());
    expect(confirmed.login.password).toBe("new-password-2");
    expect(readPasswordChangeMarker(confirmed)).toBeNull();
  });

  it("records the result in the marker", () => {
    const unsure = withChangeState(changed(), "unsure")!;
    expect(unfinishedPasswordChange(unsure)?.state).toBe("unsure");
    expect(unfinishedPasswordChange(unsure)?.at).toBe(savedAt.toISOString());
    expect(withChangeState(login(), "unsure")).toBeNull();
  });

  it("makes a marker for now, for the site", () => {
    expect(newPasswordChangeMarker("A.Example.Test", savedAt)).toEqual({
      v: 1,
      state: "pending",
      site: "a.example.test",
      at: savedAt.toISOString(),
    });
  });
});
