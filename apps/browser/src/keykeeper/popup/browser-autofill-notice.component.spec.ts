import { emptyState } from "../../autofill/keykeeper/browser-autofill-switches";

import { namesInWords, noticeFor } from "./browser-autofill-notice.component";

const acme = { id: "acme", name: "Acme Dental" };
const lake = { id: "lake", name: "Lakeside Clinic" };

describe("what the popup says about the browser's card and address autofill", () => {
  it("names the organizations that turned them off here, once, only where the extension took them", () => {
    const state = {
      ...emptyState(),
      off: true,
      orgs: [acme, lake],
      taken: { cards: true, addresses: true },
    };
    expect(noticeFor(state, "ana").note).toEqual(["Acme Dental", "Lakeside Clinic"]);
    expect(noticeFor({ ...state, seen: ["acme"] }, "ana").note).toEqual(["Lakeside Clinic"]);
    // A policy holds them (nothing taken), or Firefox, where there are no switches: no note.
    expect(noticeFor({ ...state, taken: { cards: false, addresses: false } }, "ana").note).toEqual(
      [],
    );
    expect(noticeFor({ ...state, off: false }, "ana").note).toEqual([]);
  });

  it("offers to bring them in to the accounts whose organization asks, until Done", () => {
    const state = { ...emptyState(), off: true, orgs: [acme], offerTo: ["ana"] };
    expect(noticeFor(state, "ana").offer).toBe(true);
    expect(noticeFor(state, "bo").offer).toBe(false);
    expect(noticeFor(state, null).offer).toBe(false);
    expect(noticeFor({ ...state, offered: ["ana"] }, "ana").offer).toBe(false);
  });

  it("lists names in words", () => {
    expect(namesInWords(["Acme Dental"])).toBe("Acme Dental");
    expect(namesInWords(["Acme Dental", "Lakeside Clinic"])).toBe(
      "Acme Dental and Lakeside Clinic",
    );
    expect(namesInWords(["A", "B", "C"])).toBe("A, B, and C");
  });
});
