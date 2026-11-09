import { browserAutofillMode, orgsTurningOffBrowserAutofill } from "./browser-autofill";

describe("an organization's browser autofill setting", () => {
  it("takes the server's three values, and leaves the browsers as they are otherwise", () => {
    expect(browserAutofillMode("off")).toBe("off");
    expect(browserAutofillMode("offAndImport")).toBe("offAndImport");
    for (const other of ["unchanged", undefined, null, "", "OFF", true, 1]) {
      expect(browserAutofillMode(other)).toBe("unchanged");
    }
  });

  it("counts only organizations the person is a confirmed member of", () => {
    const org = (id: string, member: boolean, mode: "unchanged" | "off" | "offAndImport") => ({
      id,
      name: id,
      member,
      keykeeperBrowserAutofill: mode,
    });
    expect(
      orgsTurningOffBrowserAutofill([
        org("a", true, "off"),
        org("b", false, "off"),
        org("c", true, "unchanged"),
        org("d", true, "offAndImport"),
      ]).map((o) => o.id),
    ).toEqual(["a", "d"]);
  });
});
