import { ClientMspStaff, LinkPreview, LinkResult } from "@bitwarden/admin-console/common";
import { translate } from "@bitwarden/common/billing/keykeeper/plan-messages.spec-util";

import {
  asRole,
  confirmLine,
  joinButton,
  joinedMessage,
  joiningLine,
  previewSentences,
  readLinkCode,
  waitingStaff,
} from "./msp-link";

/** The promise the page made before November 2026, true only of the MSP's admins. */
const OLD_PROMISE = [
  /confirms each of them/i,
  /None of them can open its items until an owner/i,
  /wait for you the same way/i,
];

describe("reading a code as people type it", () => {
  it("ignores case, spaces, and dashes, and reads O as 0 and I and L as 1", () => {
    for (const typed of [
      "7KQ2-MXP4-ZT9W-HN3R-VB8C-J5DF",
      "7kq2-mxp4-zt9w-hn3r-vb8c-j5df",
      " 7KQ2 MXP4 ZT9W HN3R VB8C J5DF ",
      "7KQ2MXP4ZT9WHN3RVB8CJ5DF",
    ]) {
      expect(readLinkCode(typed)).toBe("7KQ2MXP4ZT9WHN3RVB8CJ5DF");
    }
    expect(readLinkCode("O000-0000-0000-0000-0000-000I")).toBe("000000000000000000000001");
    expect(readLinkCode("l000-0000-0000-0000-0000-0000")).toBe("100000000000000000000000");
  });

  it("isn't a code when it's too short or long, or has anything else in it", () => {
    for (const typed of [
      "",
      "7KQ2-MXP4-ZT9W-HN3R-VB8C-J5D",
      "7KQ2-MXP4-ZT9W-HN3R-VB8C-J5DFF",
      "7KQ2-MXP4-ZT9W-HN3R-VB8C-J5DU",
      "7KQ2_MXP4_ZT9W_HN3R_VB8C_J5DF",
      "https://example.test/7KQ2MXP4ZT9WHN3RVB8CJ5DF",
    ]) {
      expect(readLinkCode(typed)).toBeNull();
    }
  });
});

const preview = (fields: Partial<LinkPreview> = {}): LinkPreview => ({
  msp: { id: "msp-1", name: "Northwind IT" },
  current: null,
  adding: [
    { email: "dana@northwind.test", name: "Dana", role: "owner" },
    { email: "sam@northwind.test", name: null, role: "admin" },
    { email: "kim@northwind.test", name: "Kim", role: "custom" },
  ],
  stayingOut: [],
  ...fields,
});

describe("what joining means, before anything changes", () => {
  it("says who's added, that an owner confirms one of the MSP's admins after comparing phrases and the rest come in on their own, what stays, and that the MSP can go", () => {
    expect(previewSentences(preview(), "Acme Dental", translate)).toEqual([
      "Northwind IT's people below are added to Acme Dental. None of them can open its items until they're confirmed. First an owner here confirms one of Northwind IT's admins, on this page, after comparing their fingerprint phrase with what they read you.",
      "Once that admin confirms Acme Dental in their MSP console, the rest of Northwind IT's people, and anyone it adds later, are let in automatically, without anyone here comparing their phrases, as long as Acme Dental lets people in when they accept an invitation (Settings, Joining and security). Each one is listed under What Northwind IT did here, on this page.",
      "Acme Dental keeps its members, items, collections, policies, and plan. Northwind IT can offer its default policies; nothing changes until someone applies them.",
      "You can remove Northwind IT at any time, on this page.",
    ]);
    expect(joinButton(preview())).toBe("Join Northwind IT");
  });

  it("never says an owner here confirms each of the MSP's people, joining, moving, or with nobody added", () => {
    for (const p of [
      preview(),
      preview({ current: { id: "msp-2", name: "Contoso IT" } }),
      preview({ adding: [] }),
    ]) {
      for (const sentence of previewSentences(p, "Acme Dental", translate)) {
        for (const promise of OLD_PROMISE) {
          expect(sentence).not.toMatch(promise);
        }
      }
    }
  });

  it("lists each person with their role", () => {
    expect(preview().adding.map(joiningLine)).toEqual([
      "Dana (dana@northwind.test), as an owner",
      "sam@northwind.test, as an admin",
      "Kim (kim@northwind.test), with a custom role",
    ]);
    expect(asRole("custom items")).toBe("with a custom role that sees every item");
  });

  it("for a move, says the MSP it has now and its staff go first", () => {
    const move = preview({ current: { id: "msp-2", name: "Contoso IT" } });
    const sentences = previewSentences(move, "Acme Dental", translate);
    expect(sentences[0]).toBe(
      "Contoso IT manages Acme Dental now. Moving removes Contoso IT and all of its staff from it first, as Remove Contoso IT does: the script and provisioning tokens and event destinations they made here stop working, and so does Contoso IT's install command. Then Northwind IT is added.",
    );
    // The new MSP's people come in as when joining: one of its admins by hand, the rest on their own.
    expect(sentences[1]).toBe(
      "Northwind IT's people below are added to Acme Dental. None of them can open its items until they're confirmed. First an owner here confirms one of Northwind IT's admins, on this page, after comparing their fingerprint phrase with what they read you.",
    );
    expect(sentences[2]).toMatch(/^Once that admin confirms Acme Dental in their MSP console, /);
    expect(sentences).toHaveLength(5);
    expect(joinButton(move)).toBe("Move to Northwind IT");
  });

  it("names the people it removed or revoked itself, who stay out", () => {
    const sentences = previewSentences(
      preview({ stayingOut: [{ email: "lee@northwind.test", name: "Lee" }] }),
      "Acme Dental",
      translate,
    );
    expect(sentences).toContain(
      "You removed or revoked Lee (lee@northwind.test) here before. They stay out until you invite them again.",
    );
  });

  it("says when nobody is added now, and how the people it adds later come in", () => {
    const sentences = previewSentences(preview({ adding: [] }), "Acme Dental", translate);
    expect(sentences[0]).toBe(
      "Nobody from Northwind IT is added now. People it adds later can't open Acme Dental's items until they're confirmed. First an owner here confirms one of Northwind IT's admins, on this page, after comparing their fingerprint phrase with what they read you.",
    );
    expect(sentences[1]).toMatch(/^Once that admin confirms Acme Dental in their MSP console, /);
  });
});

describe("the notice once it has joined", () => {
  const result = (added: number): LinkResult => ({
    msp: { id: "msp-1", name: "Northwind IT" },
    added,
    moved: null,
  });

  it("asks an owner to confirm the MSP's admin, not everyone added", () => {
    expect(joinedMessage(result(3), preview(), "Acme Dental", translate)).toBe(
      "Northwind IT now manages Acme Dental. Confirm Dana (dana@northwind.test) below once you've compared their phrase.",
    );
  });

  it("asks for one of its admins when it has several", () => {
    const two = preview({
      adding: [...preview().adding, { email: "eli@northwind.test", name: "Eli", role: "owner" }],
    });
    expect(joinedMessage(result(4), two, "Acme Dental", translate)).toBe(
      "Northwind IT now manages Acme Dental. Confirm one of its admins below once you've compared their phrase.",
    );
  });

  it("asks for everyone added when none of them is one of its admins, since nobody else can let them in", () => {
    const noAdmin = preview({ adding: preview().adding.filter((p) => p.role !== "owner") });
    expect(joinedMessage(result(2), noAdmin, "Acme Dental", translate)).toBe(
      "Northwind IT now manages Acme Dental. Confirm sam@northwind.test, Kim (kim@northwind.test) below once you've compared their phrases.",
    );
  });

  it("says only who manages it when nobody was added", () => {
    expect(joinedMessage(result(0), preview({ adding: [] }), "Acme Dental", translate)).toBe(
      "Northwind IT now manages Acme Dental.",
    );
  });
});

const staff = (fields: Partial<ClientMspStaff>): ClientMspStaff => ({
  memberId: "m-1",
  userId: "u-1",
  publicKey: "cHVibGljLWtleQ==",
  email: "dana@northwind.test",
  name: "Dana",
  type: 0,
  status: 1,
  ...fields,
});

describe("who waits for the organization's own people to confirm them", () => {
  const people = [
    staff({ memberId: "owner", type: 0 }),
    staff({ memberId: "admin", type: 1 }),
    staff({ memberId: "custom", type: 2 }),
    staff({ memberId: "confirmed", type: 1, status: 2 }),
    staff({ memberId: "keyless", type: 2, publicKey: null }),
  ];

  it("lists only those waiting for the key", () => {
    expect(waitingStaff(people, { isOwner: true }).map((w) => w.person.memberId)).toEqual([
      "owner",
      "admin",
      "custom",
      "keyless",
    ]);
  });

  it("lets an owner confirm anyone with a key, and an admin only regular members, as upstream does", () => {
    const can = (isOwner: boolean) =>
      waitingStaff(people, { isOwner }).map((w) => [w.person.memberId, w.canConfirm]);
    expect(can(true)).toEqual([
      ["owner", true],
      ["admin", true],
      ["custom", true],
      ["keyless", false],
    ]);
    expect(can(false)).toEqual([
      ["owner", false],
      ["admin", false],
      ["custom", true],
      ["keyless", false],
    ]);
  });

  it("says what to compare, and what a difference means", () => {
    expect(confirmLine({ name: "Dana", email: "dana@northwind.test" })).toBe(
      "Ask Dana to read the phrase in Settings, My account, and confirm them only if it's the same: otherwise the key this server gave out for them isn't theirs.",
    );
    expect(confirmLine({ name: null, email: "sam@northwind.test" })).toBe(
      "Ask sam@northwind.test to read the phrase in Settings, My account, and confirm them only if it's the same: otherwise the key this server gave out for them isn't theirs.",
    );
  });
});
