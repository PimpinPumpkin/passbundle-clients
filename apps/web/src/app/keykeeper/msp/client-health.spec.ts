import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import {
  clientHealth,
  clientItemsToCheck,
  expiringItems,
  StrengthScorer,
  usernameHints,
} from "./client-health";

const today = new Date(2026, 9, 15);

function login(org: string, password: string | null, username = "alex@acme.test"): CipherView {
  const cipher = new CipherView();
  cipher.id = `${org}-${password}-${Math.random()}`;
  cipher.name = `${org} ${password}`;
  cipher.type = CipherType.Login;
  cipher.organizationId = org;
  cipher.login = new LoginView();
  cipher.login.password = password;
  cipher.login.username = username;
  return cipher;
}

function expiringNote(org: string, date: string): CipherView {
  const cipher = new CipherView();
  cipher.type = CipherType.SecureNote;
  cipher.organizationId = org;
  const field = new FieldView();
  field.name = "keykeeper.expires";
  field.type = FieldType.Text;
  field.value = date;
  cipher.fields = [field];
  return cipher;
}

// Scores by length, so tests don't depend on the strength library.
const byLength: StrengthScorer = (password) => (password.length >= 12 ? 4 : 1);

describe("MSP client health", () => {
  it("counts items, weak and reused passwords, and expiring items per client", () => {
    const ciphers = [
      login("acme", "short1"),
      login("acme", "a-long-shared-passphrase"),
      login("acme", "a-long-shared-passphrase"),
      login("acme", "another-long-unique-one"),
      expiringNote("acme", "2026-10-20"),
      expiringNote("acme", "2027-03-01"),
      login("baker", "short1"),
    ];

    const health = clientHealth(ciphers, ["acme", "baker", "empty"], byLength, today);

    expect(health.get("acme")).toMatchObject({ items: 6, expiring: 1, weak: 1, reused: 2 });
    // The same password in another client isn't reuse within a client.
    expect(health.get("baker")).toMatchObject({ items: 1, expiring: 0, weak: 1, reused: 0 });
    expect(health.get("empty")).toEqual({
      items: 0,
      expiring: 0,
      weak: 0,
      reused: 0,
      exposed: undefined,
      unchecked: 0,
      toFix: [],
    });
    // Until the breach check has run, exposed is unknown.
    expect(health.get("acme")!.exposed).toBeUndefined();
  });

  it("leaves out trashed items, personal items, other organizations, and logins without passwords", () => {
    const trashed = login("acme", "short1");
    trashed.deletedDate = new Date(2026, 9, 1);
    const ciphers = [
      trashed,
      login(null as unknown as string, "short1"),
      login("other", "short1"),
      login("acme", null),
    ];

    expect(clientHealth(ciphers, ["acme"], byLength, today).get("acme")).toMatchObject({
      items: 1,
      expiring: 0,
      weak: 0,
      reused: 0,
    });
  });

  it("counts exposed passwords from the breach check, and the ones it couldn't check", () => {
    const ciphers = [
      login("acme", "password1"),
      login("acme", "password1"),
      login("acme", "a-long-unique-passphrase"),
      login("acme", "another-long-unique-one"),
      login("baker", "password1"),
      login("baker", "never-checked-but-long"),
    ];
    const exposed = new Map<string, number | null>([
      ["password1", 2_400_000],
      ["a-long-unique-passphrase", 0],
      ["another-long-unique-one", 3],
      ["never-checked-but-long", null],
    ]);

    const health = clientHealth(ciphers, ["acme", "baker"], byLength, today, exposed);

    expect(health.get("acme")).toMatchObject({ weak: 2, reused: 2, exposed: 3, unchecked: 0 });
    expect(health.get("baker")).toMatchObject({ weak: 1, reused: 0, exposed: 1, unchecked: 1 });
    // The items to fix, by name, the most exposed first; never the passwords.
    expect(health.get("acme")!.toFix.map((i) => [i.name, i.weak, i.reused, i.exposed])).toEqual([
      ["acme password1", true, true, 2_400_000],
      ["acme password1", true, true, 2_400_000],
      ["acme another-long-unique-one", false, false, 3],
    ]);
    expect(Object.keys(health.get("acme")!.toFix[0]).sort()).toEqual(
      ["exposed", "id", "name", "organizationId", "reused", "weak"].sort(),
    );
    // A password that couldn't be checked and has nothing else wrong isn't listed.
    expect(health.get("baker")!.toFix.map((i) => i.name)).toEqual(["baker password1"]);
  });

  it("checks the passwords staff may see, in every client and nowhere else", () => {
    const hidden = login("acme", "hidden-one");
    hidden.viewPassword = false;
    const ciphers = [
      login("acme", "password1"),
      login("baker", "password1"),
      login("baker", "other"),
      login("elsewhere", "not-a-client"),
      hidden,
    ];

    expect(clientItemsToCheck(ciphers, ["acme", "baker"])).toEqual(ciphers.slice(0, 3));
  });

  it("gives the scorer the username's parts as hints, as upstream's weak passwords report does", () => {
    const seen: (string[] | null)[] = [];
    const recording: StrengthScorer = (_password, hints) => {
      seen.push(hints);
      return 4;
    };

    clientHealth(
      [login("acme", "x", "jane.doe@acme.test"), login("acme", "y", "ab")],
      ["acme"],
      recording,
      today,
    );

    expect(seen).toEqual([["jane", "doe"], null]);
    expect(usernameHints("Front.Desk-01")).toEqual(["front", "desk"]);
  });
});

describe("Expiring across clients", () => {
  const named = (cipher: CipherView, id: string, name: string) =>
    Object.assign(cipher, { id, name });
  const clients = [
    { id: "acme", name: "Acme Dental" },
    { id: "baker", name: "Baker Law" },
  ];

  it("lists expired and soon-expiring items in the clients' vaults, soonest first", () => {
    const list = expiringItems(
      [
        named(expiringNote("baker", "2026-10-30"), "1", "Wildcard certificate"),
        named(expiringNote("acme", "2026-09-30"), "2", "Old license"),
        named(expiringNote("acme", "2026-10-15"), "3", "Domain"),
        named(expiringNote("acme", "2027-03-01"), "4", "Far off"),
        named(expiringNote("elsewhere", "2026-10-01"), "5", "Not a client's"),
        named(login("acme", "x"), "6", "No date"),
      ],
      clients,
      today,
    );

    expect(list.map((i) => [i.name, i.client, i.status.state])).toEqual([
      ["Old license", "Acme Dental", "expired"],
      ["Domain", "Acme Dental", "today"],
      ["Wildcard certificate", "Baker Law", "soon"],
    ]);
  });

  it("leaves out the trash", () => {
    const trashed = named(expiringNote("acme", "2026-10-01"), "1", "Trashed");
    trashed.deletedDate = new Date(2026, 9, 2);
    expect(expiringItems([trashed], clients, today)).toEqual([]);
  });
});
