import { CipherType } from "../../vault/enums";
import { CipherView } from "../../vault/models/view/cipher.view";
import { LoginView } from "../../vault/models/view/login.view";

import {
  checksPassword,
  isWeakScore,
  needsFixing,
  passwordProblems,
  passwordScore,
  reusedPasswords,
  StrengthScorer,
  usernameHints,
} from "./password-health";

function login(
  password: string | null,
  { org = null as string | null, edit = true, viewPassword = true, username = "" } = {},
): CipherView {
  const cipher = new CipherView();
  cipher.type = CipherType.Login;
  cipher.organizationId = org as string;
  cipher.edit = edit;
  cipher.viewPassword = viewPassword;
  cipher.login = new LoginView();
  cipher.login.password = password;
  cipher.login.username = username;
  return cipher;
}

// Scores by length, so tests don't depend on the strength library.
const byLength: StrengthScorer = (password) => (password.length >= 12 ? 4 : 1);
const weak = (cipher: CipherView) => isWeakScore(passwordScore(cipher, byLength));

describe("password health rules", () => {
  it("checks logins with a password the person may see, outside the trash, and their own only when asked", () => {
    const note = new CipherView();
    note.type = CipherType.SecureNote;
    const trashed = login("short1");
    trashed.deletedDate = new Date(2026, 9, 1);

    expect(checksPassword(login("short1"), true)).toBe(true);
    expect(checksPassword(note, false)).toBe(false);
    expect(checksPassword(login(null), false)).toBe(false);
    expect(checksPassword(login(""), false)).toBe(false);
    expect(checksPassword(trashed, false)).toBe(false);
    expect(checksPassword(login("short1", { viewPassword: false }), false)).toBe(false);
    // Read-only items: an admin's report looks at them, a person's own Health doesn't.
    expect(checksPassword(login("short1", { edit: false }), false)).toBe(true);
    expect(checksPassword(login("short1", { edit: false }), true)).toBe(false);
  });

  it("scores with the username's parts as hints, and weak is 2 or less", () => {
    expect(usernameHints(" Alex.Smith@acme.test ")).toEqual(["alex", "smith"]);
    expect(usernameHints("bo")).toEqual([]);
    const score = jest.fn<number, [string, string[] | null]>(() => 2);
    expect(passwordScore(login("pw", { username: "frontdesk@acme.test" }), score)).toBe(2);
    expect(score).toHaveBeenCalledWith("pw", ["frontdesk"]);
    passwordScore(login("pw"), score);
    expect(score).toHaveBeenLastCalledWith("pw", null);

    expect([0, 1, 2, 3, 4, null].map(isWeakScore)).toEqual([true, true, true, false, false, false]);
  });

  it("counts reuse within a group only", () => {
    const a = login("shared", { org: "acme" });
    const b = login("shared", { org: "acme" });
    const c = login("shared", { org: "baker" });
    const d = login("unique", { org: "acme" });

    expect(reusedPasswords([a, b, c, d])).toEqual([a, b, c]);
    expect(reusedPasswords([a, b, c, d], (cipher) => cipher.organizationId)).toEqual([a, b]);
  });

  it("lists every checked item with what's wrong, and which ones need fixing", () => {
    const weakOne = login("short1");
    const reusedA = login("a-long-shared-passphrase");
    const reusedB = login("a-long-shared-passphrase");
    const exposed = login("long-but-in-a-breach");
    const fine = login("long-unique-and-unseen");
    const unchecked = login("long-and-never-checked");
    const hidden = login("short2", { viewPassword: false });

    const results = new Map<string, number | null>([
      ["short1", 0],
      ["a-long-shared-passphrase", 0],
      ["long-but-in-a-breach", 12],
      ["long-unique-and-unseen", 0],
      ["long-and-never-checked", null],
    ]);
    const problems = passwordProblems(
      [weakOne, reusedA, reusedB, exposed, fine, unchecked, hidden],
      { needsEdit: true, weak, exposed: results },
    );

    expect(problems.map((p) => [p.cipher, p.weak, p.reused, p.exposed])).toEqual([
      [weakOne, true, false, 0],
      [reusedA, false, true, 0],
      [reusedB, false, true, 0],
      [exposed, false, false, 12],
      [fine, false, false, 0],
      [unchecked, false, false, null],
    ]);
    expect(problems.filter(needsFixing).map((p) => p.cipher)).toEqual([
      weakOne,
      reusedA,
      reusedB,
      exposed,
    ]);
  });

  it("leaves exposure unknown until the check has run", () => {
    const [problems] = passwordProblems([login("short1")], { needsEdit: false, weak });
    expect(problems.exposed).toBeUndefined();
    expect(needsFixing(problems)).toBe(true);
  });
});
