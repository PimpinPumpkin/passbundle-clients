import { CipherType } from "@bitwarden/common/vault/enums";

import {
  AccessFlags,
  AccessGrant,
  AccessItemInput,
  AccessMemberInput,
  AccessReviewInput,
  folderMatches,
  howText,
  levelOf,
  memberMatches,
  mergeFlags,
  passwordListText,
  passwordsSeenBy,
  reachOf,
  reachSentence,
  reviewAccess,
} from "./access-review";

const CAN_VIEW: AccessFlags = { readOnly: true, hidePasswords: false, manage: false };
const CAN_VIEW_HIDDEN: AccessFlags = { readOnly: true, hidePasswords: true, manage: false };
const CAN_EDIT: AccessFlags = { readOnly: false, hidePasswords: false, manage: false };
const CAN_EDIT_HIDDEN: AccessFlags = { readOnly: false, hidePasswords: true, manage: false };
const CAN_MANAGE: AccessFlags = { readOnly: false, hidePasswords: false, manage: true };

const grant = (id: string, flags: AccessFlags): AccessGrant => ({ id, ...flags });

function member(id: string, extra: Partial<AccessMemberInput> = {}): AccessMemberInput {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    email: `${id}@example.test`,
    role: "user",
    status: "confirmed",
    allItems: false,
    mspStaff: false,
    collections: [],
    groups: [],
    ...extra,
  };
}

function item(
  id: string,
  collectionIds: string[],
  extra: Partial<AccessItemInput> = {},
): AccessItemInput {
  return { id, name: id, type: CipherType.Login, collectionIds, deleted: false, ...extra };
}

const folders = [
  { id: "front", name: "Front desk" },
  { id: "payroll", name: "Payroll" },
  { id: "it", name: "IT" },
];

function input(extra: Partial<AccessReviewInput> = {}): AccessReviewInput {
  return {
    members: [],
    groups: [],
    folders,
    items: [],
    adminsSeeEverything: true,
    ...extra,
  };
}

/** Message keys and their arguments, so tests read what the page would say. */
const t = (key: string, ...args: string[]) => (args.length ? `${key}(${args.join("|")})` : key);

describe("levelOf", () => {
  it("names upstream's five permissions", () => {
    expect(levelOf(CAN_VIEW)).toBe("view");
    expect(levelOf(CAN_VIEW_HIDDEN)).toBe("viewHidden");
    expect(levelOf(CAN_EDIT)).toBe("edit");
    expect(levelOf(CAN_EDIT_HIDDEN)).toBe("editHidden");
    expect(levelOf(CAN_MANAGE)).toBe("manage");
  });
});

describe("mergeFlags", () => {
  it("lets someone edit if any way lets them", () => {
    expect(levelOf(mergeFlags([CAN_VIEW, CAN_EDIT]))).toBe("edit");
  });

  it("hides passwords only if every way hides them", () => {
    expect(levelOf(mergeFlags([CAN_VIEW_HIDDEN, CAN_VIEW]))).toBe("view");
    expect(levelOf(mergeFlags([CAN_VIEW_HIDDEN, CAN_EDIT_HIDDEN]))).toBe("editHidden");
    // Edit from one way and passwords from the other: both, as the server decides.
    expect(levelOf(mergeFlags([CAN_EDIT_HIDDEN, CAN_VIEW]))).toBe("edit");
  });

  it("lets someone manage if any way does", () => {
    expect(levelOf(mergeFlags([CAN_VIEW_HIDDEN, CAN_MANAGE]))).toBe("manage");
  });
});

describe("reviewAccess", () => {
  it("shows a folder given directly", () => {
    const review = reviewAccess(
      input({ members: [member("alex", { collections: [grant("front", CAN_EDIT)] })] }),
    );

    const [alex] = review.members;
    expect(alex.everyItem).toBeNull();
    expect(alex.folders).toHaveLength(1);
    expect(alex.folders[0].folder.name).toBe("Front desk");
    expect(alex.folders[0].level).toBe("edit");
    expect(alex.folders[0].paths).toEqual([
      { groupId: null, groupName: null, flags: CAN_EDIT, level: "edit" },
    ]);
  });

  it("shows a folder reached through a group, naming the group", () => {
    const review = reviewAccess(
      input({
        members: [member("alex", { groups: ["office"] })],
        groups: [{ id: "office", name: "Front office", collections: [grant("payroll", CAN_VIEW)] }],
      }),
    );

    const [folder] = review.members[0].folders;
    expect(folder.folder.name).toBe("Payroll");
    expect(folder.level).toBe("view");
    expect(folder.paths).toEqual([
      { groupId: "office", groupName: "Front office", flags: CAN_VIEW, level: "view" },
    ]);
  });

  it("merges a folder reached two ways: the more open permission wins", () => {
    const review = reviewAccess(
      input({
        members: [
          member("alex", { collections: [grant("front", CAN_VIEW_HIDDEN)], groups: ["office"] }),
        ],
        groups: [
          { id: "office", name: "Front office", collections: [grant("front", CAN_EDIT_HIDDEN)] },
        ],
      }),
    );

    const [folder] = review.members[0].folders;
    expect(folder.level).toBe("editHidden");
    expect(folder.flags.hidePasswords).toBe(true);
    expect(folder.paths.map((p) => p.groupId)).toEqual([null, "office"]);
  });

  it("shows passwords when only one of two ways hides them", () => {
    const review = reviewAccess(
      input({
        members: [member("alex", { collections: [grant("front", CAN_VIEW)], groups: ["office"] })],
        groups: [{ id: "office", name: "Office", collections: [grant("front", CAN_VIEW_HIDDEN)] }],
      }),
    );

    expect(review.members[0].folders[0].level).toBe("view");
    expect(review.members[0].folders[0].flags.hidePasswords).toBe(false);
  });

  it("merges two groups that reach the same folder", () => {
    const review = reviewAccess(
      input({
        members: [member("alex", { groups: ["a", "b"] })],
        groups: [
          { id: "b", name: "Billing", collections: [grant("payroll", CAN_MANAGE)] },
          { id: "a", name: "Accounting", collections: [grant("payroll", CAN_VIEW_HIDDEN)] },
        ],
      }),
    );

    const [folder] = review.members[0].folders;
    expect(folder.level).toBe("manage");
    expect(folder.paths.map((p) => p.groupName)).toEqual(["Accounting", "Billing"]);
  });

  it("gives owners and admins every item, and lists them with every folder", () => {
    const review = reviewAccess(
      input({
        members: [
          member("pat", { role: "owner", collections: [grant("front", CAN_VIEW)] }),
          member("sam", { role: "admin" }),
          member("alex", { collections: [grant("front", CAN_VIEW)] }),
        ],
        items: [item("a", ["front"]), item("b", [])],
      }),
    );

    const byId = new Map(review.members.map((m) => [m.member.id, m]));
    expect(byId.get("pat")!.everyItem).toBe("owner");
    expect(byId.get("pat")!.folders).toEqual([]);
    expect(byId.get("sam")!.everyItem).toBe("admin");
    expect(byId.get("alex")!.everyItem).toBeNull();
    const front = review.folders.find((f) => f.folder.id === "front")!;
    expect(front.people.map((p) => p.member.id)).toEqual(["alex"]);
    expect(front.everyItemPeople.map((m) => m.id)).toEqual(["pat", "sam"]);
    expect(reachOf(byId.get("pat")!, review)).toEqual({ folders: 3, items: 2 });
  });

  it("gives every item to anyone with access to all items, such as MSP staff with vault items", () => {
    const review = reviewAccess(
      input({
        members: [member("tech", { role: "custom", allItems: true, mspStaff: true })],
      }),
    );

    expect(review.members[0].everyItem).toBe("allItems");
  });

  it("uses an admin's own folders where admins don't see every item", () => {
    const review = reviewAccess(
      input({
        members: [member("sam", { role: "admin", collections: [grant("it", CAN_MANAGE)] })],
        adminsSeeEverything: false,
      }),
    );

    expect(review.members[0].everyItem).toBeNull();
    expect(review.members[0].folders.map((f) => f.folder.id)).toEqual(["it"]);
  });

  it("leaves out folders the viewer can't see", () => {
    const review = reviewAccess(
      input({
        members: [
          member("alex", { collections: [grant("front", CAN_VIEW), grant("secret", CAN_VIEW)] }),
        ],
      }),
    );

    expect(review.members[0].folders.map((f) => f.folder.id)).toEqual(["front"]);
  });

  it("names a group it can't list as a group", () => {
    const review = reviewAccess(
      input({
        members: [member("alex", { groups: ["office"] })],
        groups: [{ id: "office", name: null, collections: [grant("front", CAN_VIEW)] }],
      }),
    );

    expect(howText(review.members[0].folders[0].paths, t)).toBe("keykeeperAccessThroughAGroup");
  });

  it("counts each folder's items, leaving out the trash, and each item once across folders", () => {
    const review = reviewAccess(
      input({
        members: [
          member("alex", { collections: [grant("front", CAN_VIEW), grant("payroll", CAN_VIEW)] }),
        ],
        items: [
          item("a", ["front"]),
          item("b", ["front", "payroll"]),
          item("c", ["payroll"], { deleted: true }),
          item("d", ["it"]),
        ],
      }),
    );

    const counts = Object.fromEntries(review.folders.map((f) => [f.folder.id, f.itemCount]));
    expect(counts).toEqual({ front: 2, payroll: 1, it: 1 });
    expect(review.itemCount).toBe(3);
    expect(reachOf(review.members[0], review)).toEqual({ folders: 2, items: 2 });
  });

  it("lists people by name, and folders by name", () => {
    const review = reviewAccess(
      input({
        members: [member("zoe"), member("adam"), member("mia", { name: null })],
      }),
    );

    expect(review.members.map((m) => m.member.id)).toEqual(["adam", "mia", "zoe"]);
    expect(review.folders.map((f) => f.folder.name)).toEqual(["Front desk", "IT", "Payroll"]);
  });
});

describe("passwordsSeenBy", () => {
  const items = [
    item("Wi-Fi", ["front"]),
    item("Payroll portal", ["payroll"]),
    item("Bank", ["payroll", "front"]),
    item("Old router", ["front"], { deleted: true }),
    item("Door codes", ["front"], { type: CipherType.SecureNote }),
    item("Card", ["front"], { type: CipherType.Card }),
    item("Unfiled", []),
  ];

  function seen(m: AccessMemberInput, groups: AccessReviewInput["groups"] = []) {
    const review = reviewAccess(input({ members: [m], groups, items }));
    return passwordsSeenBy(review.members[0], items, folders);
  }

  it("lists logins in folders where passwords aren't hidden, with the folders they were seen in", () => {
    const list = seen(
      member("alex", {
        collections: [grant("front", CAN_EDIT)],
        groups: ["office"],
      }),
      [{ id: "office", name: "Office", collections: [grant("payroll", CAN_VIEW_HIDDEN)] }],
    );

    expect(list.map((s) => [s.item.name, s.folders.map((f) => f.name)])).toEqual([
      // In Payroll too, but its password was only visible through Front desk.
      ["Bank", ["Front desk"]],
      ["Wi-Fi", ["Front desk"]],
    ]);
  });

  it("leaves out logins only in folders where every way hides passwords", () => {
    const list = seen(
      member("alex", { collections: [grant("payroll", CAN_VIEW_HIDDEN)], groups: ["office"] }),
      [{ id: "office", name: "Office", collections: [grant("payroll", CAN_EDIT_HIDDEN)] }],
    );

    expect(list).toEqual([]);
  });

  it("includes logins whose passwords one way shows, even if another hides them", () => {
    const list = seen(
      member("alex", { collections: [grant("payroll", CAN_VIEW_HIDDEN)], groups: ["office"] }),
      [{ id: "office", name: "Office", collections: [grant("payroll", CAN_VIEW)] }],
    );

    expect(list.map((s) => s.item.name)).toEqual(["Bank", "Payroll portal"]);
  });

  it("lists every login, filed or not, for someone who sees every item", () => {
    const list = seen(member("sam", { role: "admin" }));

    expect(list.map((s) => [s.item.name, s.folders.map((f) => f.name)])).toEqual([
      ["Bank", ["Front desk", "Payroll"]],
      ["Payroll portal", ["Payroll"]],
      ["Unfiled", []],
      ["Wi-Fi", ["Front desk"]],
    ]);
  });

  it("never lists notes, cards, or items in the trash", () => {
    const names = seen(member("sam", { role: "owner" })).map((s) => s.item.name);

    expect(names).not.toContain("Door codes");
    expect(names).not.toContain("Card");
    expect(names).not.toContain("Old router");
  });
});

describe("passwordListText", () => {
  it("has names and folders only, tab separated, with a header", () => {
    const text = passwordListText(
      [
        { item: item("Wi-Fi", ["front"]), folders: [folders[0]] },
        { item: item("Bank\tlogin", ["front"]), folders: [folders[0], folders[1]] },
        { item: item("Unfiled", []), folders: [] },
      ],
      { name: "Name", folders: "Shared folders", noFolder: "No shared folder" },
    );

    expect(text).toBe(
      "Name\tShared folders\nWi-Fi\tFront desk\nBank login\tFront desk, Payroll\nUnfiled\tNo shared folder\n",
    );
  });

  it("carries nothing from an item but its name", () => {
    const secretItem = {
      ...item("Router", ["front"]),
      login: { username: "admin", password: "hunter2", totp: "otpauth://x" },
      notes: "the code is 1234",
    } as AccessItemInput;

    const text = passwordListText([{ item: secretItem, folders: [folders[0]] }], {
      name: "Name",
      folders: "Shared folders",
      noFolder: "-",
    });

    expect(text).not.toMatch(/hunter2|admin|otpauth|1234/);
  });
});

describe("reachSentence", () => {
  const review = (m: AccessMemberInput) =>
    reviewAccess(
      input({
        members: [m],
        items: [item("a", ["front"]), item("b", ["payroll"]), item("c", ["payroll"])],
      }),
    );
  const sentence = (m: AccessMemberInput) => {
    const r = review(m);
    return reachSentence("Alex", r.members[0], r, t);
  };

  it("says how many folders and items someone opens", () => {
    expect(
      sentence(
        member("alex", { collections: [grant("front", CAN_VIEW), grant("payroll", CAN_VIEW)] }),
      ),
    ).toBe("keykeeperReachFolders(Alex|keykeeperSharedFolderCount(2)|keykeeperItemCount(3))");
    expect(sentence(member("alex", { collections: [grant("front", CAN_VIEW)] }))).toBe(
      "keykeeperReachFolders(Alex|keykeeperOneSharedFolder|keykeeperOneItem)",
    );
  });

  it("says when someone sees every item", () => {
    expect(sentence(member("alex", { role: "admin" }))).toBe(
      "keykeeperReachEveryItem(Alex|keykeeperItemCount(3))",
    );
  });

  it("says when someone opens no folders", () => {
    expect(sentence(member("alex"))).toBe("keykeeperReachNoFolders(Alex)");
  });

  it("speaks of the past for someone revoked", () => {
    expect(
      sentence(member("alex", { status: "revoked", collections: [grant("front", CAN_VIEW)] })),
    ).toBe("keykeeperReachFoldersRevoked(Alex|keykeeperOneSharedFolder|keykeeperOneItem)");
  });

  it("says someone never confirmed never had the key", () => {
    expect(
      sentence(member("alex", { status: "pending", collections: [grant("front", CAN_VIEW)] })),
    ).toBe("keykeeperReachNeverConfirmed(Alex)");
  });
});

describe("howText", () => {
  it("says how, with each way's permission when there are several", () => {
    const review = reviewAccess(
      input({
        members: [member("alex", { collections: [grant("front", CAN_EDIT)], groups: ["office"] })],
        groups: [{ id: "office", name: "Office", collections: [grant("front", CAN_VIEW_HIDDEN)] }],
      }),
    );

    expect(howText(review.members[0].folders[0].paths, t)).toBe(
      "keykeeperAccessDirectly (keykeeperCanEdit), keykeeperAccessThroughGroup(Office) (keykeeperCanViewHidden)",
    );
    expect(howText(review.members[0].folders[0].paths.slice(0, 1), t)).toBe(
      "keykeeperAccessDirectly",
    );
  });
});

describe("search", () => {
  const review = reviewAccess(
    input({
      members: [
        member("alex", { collections: [grant("front", CAN_VIEW)] }),
        member("blair", { groups: ["office"] }),
      ],
      groups: [{ id: "office", name: "Front office", collections: [grant("payroll", CAN_VIEW)] }],
    }),
  );
  const [alex, blair] = review.members;

  it("finds people by name, email, folder, or group", () => {
    expect(memberMatches(alex, "ALEX")).toBe(true);
    expect(memberMatches(alex, "alex@example")).toBe(true);
    expect(memberMatches(alex, "front desk")).toBe(true);
    expect(memberMatches(blair, "front office")).toBe(true);
    expect(memberMatches(alex, "payroll")).toBe(false);
    expect(memberMatches(alex, "  ")).toBe(true);
  });

  it("finds folders by name, person, or group", () => {
    const [front, , payroll] = review.folders;
    expect(folderMatches(front, "front")).toBe(true);
    expect(folderMatches(payroll, "blair")).toBe(true);
    expect(folderMatches(payroll, "front office")).toBe(true);
    expect(folderMatches(front, "blair")).toBe(false);
  });
});
