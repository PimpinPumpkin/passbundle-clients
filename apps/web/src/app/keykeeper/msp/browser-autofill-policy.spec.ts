import { KEYKEEPER_BROWSER_AUTOFILL_OFF_POLICY } from "@bitwarden/admin-console/common";

import { offerData, offersImport, withBrowserAutofillOff } from "./browser-autofill-policy";

describe("the MSP default that turns off the browsers' card and address autofill", () => {
  it("keeps its one option, the offer, and null without it", () => {
    expect(offerData(true, true)).toEqual({ offer: true });
    expect(offerData(true, false)).toBeNull();
    expect(offerData(false, true)).toBeNull();
    expect(offersImport({ offer: true })).toBe(true);
    for (const data of [null, undefined, {}, { offer: false }, { offer: "true" }]) {
      expect(offersImport(data)).toBe(false);
    }
  });

  it("is offered last, only when the server offers it", () => {
    const upstream = [{ type: 0 }, { type: 1 }] as never[];
    expect(withBrowserAutofillOff(upstream, [0, 1]).map((d) => d.type)).toEqual([0, 1]);
    expect(
      withBrowserAutofillOff(upstream, [0, 1, KEYKEEPER_BROWSER_AUTOFILL_OFF_POLICY]).map(
        (d) => d.type,
      ),
    ).toEqual([0, 1, KEYKEEPER_BROWSER_AUTOFILL_OFF_POLICY]);
  });
});
