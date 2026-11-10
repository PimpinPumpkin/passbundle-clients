import { attachingOff, attachmentsWindowOpens } from "./attachments-plan";

describe("attachingOff", () => {
  it("lets a person with Premium add files to a personal item", () => {
    expect(attachingOff(null, null, true)).toBeNull();
    expect(attachingOff(undefined, undefined, true)).toBeNull();
    expect(attachingOff("", null, true)).toBeNull();
  });

  it("turns adding off on a personal item without Premium", () => {
    expect(attachingOff(null, null, false)).toBe("premium");
  });

  it("goes by the organization's storage for a shared item, not the person's plan", () => {
    expect(attachingOff("org", { maxStorageGb: 5 }, false)).toBeNull();
    expect(attachingOff("org", { maxStorageGb: 5 }, true)).toBeNull();
    expect(attachingOff("org", { maxStorageGb: 0 }, true)).toBe("organization");
    expect(attachingOff("org", { maxStorageGb: null }, true)).toBe("organization");
    expect(attachingOff("org", {}, false)).toBe("organization");
  });

  it("leaves an organization the person isn't in to the server", () => {
    expect(attachingOff("org", null, false)).toBeNull();
    expect(attachingOff("org", undefined, true)).toBeNull();
  });
});

describe("attachmentsWindowOpens", () => {
  it("opens for an item with files on any plan", () => {
    expect(attachmentsWindowOpens(true, "premium")).toBe(true);
    expect(attachmentsWindowOpens(true, "organization")).toBe(true);
    expect(attachmentsWindowOpens(true, null)).toBe(true);
  });

  it("opens for an item files can be added to", () => {
    expect(attachmentsWindowOpens(false, null)).toBe(true);
  });

  it("stays shut for an item with no files and no right to add", () => {
    expect(attachmentsWindowOpens(false, "premium")).toBe(false);
    expect(attachmentsWindowOpens(false, "organization")).toBe(false);
  });
});
