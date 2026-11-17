import { allSelected, clickAll, clickRow } from "./popup-selection";

describe("selecting several items in the popup", () => {
  const order = ["a", "b", "c", "d", "e"];

  describe("clickRow", () => {
    it("selects a row, after the ones already selected", () => {
      expect(clickRow(["c"], order, "a", undefined, false)).toEqual({
        ids: ["c", "a"],
        limited: false,
      });
    });

    it("lets go of a selected row", () => {
      expect(clickRow(["a", "c"], order, "a", "c", false)).toEqual({ ids: ["c"], limited: false });
    });

    it("with Shift, selects every row from the last one clicked to this one", () => {
      expect(clickRow(["b"], order, "d", "b", true).ids).toEqual(["b", "d", "c"]);
    });

    it("with Shift, works upward too", () => {
      expect(clickRow(["d"], order, "b", "d", true).ids).toEqual(["d", "b", "c"]);
    });

    it("with Shift on a selected row, lets go of the whole range", () => {
      expect(clickRow(["a", "b", "c", "d"], order, "c", "a", true).ids).toEqual(["d"]);
    });

    it("with Shift and nothing clicked before, toggles the one row", () => {
      expect(clickRow([], order, "c", undefined, true).ids).toEqual(["c"]);
    });

    it("with Shift, when the last row clicked has left the list, takes only this one", () => {
      expect(clickRow([], order, "c", "gone", true).ids).toEqual(["c"]);
    });

    it("selects no more than the limit, and says it stopped there", () => {
      expect(clickRow(["a", "b"], order, "c", undefined, false, 2)).toEqual({
        ids: ["a", "b"],
        limited: true,
      });
      // A range takes the clicked row first, so it's in even when the range is cut.
      expect(clickRow(["a"], order, "e", "b", true, 3)).toEqual({
        ids: ["a", "e", "b"],
        limited: true,
      });
    });
  });

  describe("clickAll", () => {
    it("selects every row shown, top to bottom", () => {
      expect(clickAll(["c"], order)).toEqual({ ids: order, limited: false });
    });

    it("lets go of everything once everything is selected", () => {
      expect(clickAll(["e", "d", "c", "b", "a"], order)).toEqual({ ids: [], limited: false });
    });

    it("stops at the limit, and says so", () => {
      expect(clickAll([], order, 3)).toEqual({ ids: ["a", "b", "c"], limited: true });
    });

    it("lets go of everything when as many as the limit allows are selected", () => {
      expect(clickAll(["a", "b", "c"], order, 3)).toEqual({ ids: [], limited: false });
    });
  });

  describe("allSelected", () => {
    it("is checked only when every row shown is selected", () => {
      expect(allSelected(["a", "b"], order)).toBe(false);
      expect(allSelected(order, order)).toBe(true);
    });

    it("is never checked for an empty list", () => {
      expect(allSelected([], [])).toBe(false);
    });

    it("is checked when the limit is reached", () => {
      expect(allSelected(["a", "b"], order, 2)).toBe(true);
    });

    it("counts only the rows still shown", () => {
      expect(allSelected(["a", "gone"], ["a", "b"])).toBe(false);
    });
  });
});
