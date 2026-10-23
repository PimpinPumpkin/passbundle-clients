import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { printableFields, printableItem } from "./print-item";

const t = (key: string) => key;

function field(name: string, value: string, type = FieldType.Text) {
  return Object.assign(new FieldView(), { name, value, type });
}

function login(): CipherView {
  const cipher = new CipherView();
  cipher.type = CipherType.Login;
  cipher.name = "Bank <main>";
  cipher.login = Object.assign(new LoginView(), {
    username: "ana",
    password: "pa55",
    totp: "otpauth://totp/secret",
    uris: [Object.assign(new LoginUriView(), { uri: "https://bank.example" })],
  });
  cipher.notes = "PIN by the door";
  cipher.fields = [
    field("Branch", "Main St"),
    field("keykeeper.expires", "2027-01-01"),
    field("Linked", "", FieldType.Linked),
  ];
  return cipher;
}

describe("printableFields", () => {
  it("prints what someone who can see passwords sees, and never PassBundle's own fields", () => {
    expect(printableFields(login(), t)).toEqual([
      ["username", "ana"],
      ["password", "pa55"],
      ["website", "https://bank.example"],
      ["Branch", "Main St"],
      ["notes", "PIN by the door"],
    ]);
  });

  it("leaves off the one-time code key, which nobody types from paper", () => {
    expect(printableFields(login(), t).some(([, value]) => value.includes("otpauth"))).toBe(false);
  });
});

describe("printableItem", () => {
  it("escapes the item, so a name can't add anything to the page", () => {
    const page = printableItem(login(), t);
    expect(page).toContain("<h1>Bank &lt;main&gt;</h1>");
    expect(page).not.toContain("<main>");
  });
});
