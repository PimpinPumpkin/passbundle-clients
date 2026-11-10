import {
  MAX_SELECTION,
  rangeBetween,
  runEach,
  splitByAllowed,
  stillListed,
} from "./bulk-selection";

describe("selecting several items", () => {
  describe("rangeBetween", () => {
    const rows = ["a", "b", "c", "d", "e"];

    it("takes both ends and everything between them, top to bottom", () => {
      expect(rangeBetween(rows, "b", "d")).toEqual(["b", "c", "d"]);
    });

    it("works upward as well, and keeps the list's order", () => {
      expect(rangeBetween(rows, "d", "b")).toEqual(["b", "c", "d"]);
    });

    it("is the one row when both ends are the same", () => {
      expect(rangeBetween(rows, "c", "c")).toEqual(["c"]);
    });

    it("is only the clicked row when the anchor is no longer in the list", () => {
      expect(rangeBetween(rows, "gone", "d")).toEqual(["d"]);
    });

    it("is only the clicked row when it isn't in the list itself", () => {
      expect(rangeBetween(rows, "a", "gone")).toEqual(["gone"]);
    });

    it("finds rows by the comparison it is given", () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const range = rangeBetween(items, { id: 3 }, { id: 2 }, (a, b) => a.id === b.id);
      expect(range).toEqual([{ id: 2 }, { id: 3 }]);
    });
  });

  describe("stillListed", () => {
    const key = (row: { id: string }) => row.id;

    it("swaps each selected row for the copy the list has now", () => {
      const old = [{ id: "a", name: "before" }];
      const listed = [
        { id: "a", name: "after" },
        { id: "b", name: "other" },
      ];

      const kept = stillListed(old, listed, key);

      expect(kept).toEqual([{ id: "a", name: "after" }]);
      expect(kept[0]).toBe(listed[0]);
    });

    it("lets go of a row that left the list", () => {
      const kept = stillListed(
        [{ id: "a" }, { id: "gone" }, { id: "c" }],
        [{ id: "c" }, { id: "a" }],
        key,
      );

      expect(kept).toEqual([{ id: "a" }, { id: "c" }]);
    });

    it("keeps nothing when the list is empty", () => {
      expect(stillListed([{ id: "a" }], [], key)).toEqual([]);
    });
  });

  describe("splitByAllowed", () => {
    it("keeps the order of both halves", () => {
      expect(splitByAllowed(["a", "b", "c", "d"], [true, false, true, false])).toEqual({
        allowed: ["a", "c"],
        skipped: ["b", "d"],
      });
    });

    it("skips an item nobody answered for", () => {
      expect(splitByAllowed(["a", "b"], [true])).toEqual({ allowed: ["a"], skipped: ["b"] });
    });

    it("has nothing to do for an empty selection", () => {
      expect(splitByAllowed([], [])).toEqual({ allowed: [], skipped: [] });
    });
  });

  describe("runEach", () => {
    it("does every item in order and reports progress before each one and at the end", async () => {
      const seen: string[] = [];
      const progress: [number, number][] = [];

      const run = await runEach(
        ["a", "b", "c"],
        async (item) => {
          seen.push(item);
        },
        (finished, total) => progress.push([finished, total]),
      );

      expect(seen).toEqual(["a", "b", "c"]);
      expect(run).toEqual({ done: ["a", "b", "c"], failed: [] });
      expect(progress).toEqual([
        [0, 3],
        [1, 3],
        [2, 3],
        [3, 3],
      ]);
    });

    it("carries on past a failure and says which ones failed", async () => {
      const run = await runEach(["a", "b", "c"], async (item) => {
        if (item === "b") {
          throw new Error("refused");
        }
      });

      expect(run).toEqual({ done: ["a", "c"], failed: ["b"] });
    });
  });

  it("takes as many at once as selecting all always did", () => {
    expect(MAX_SELECTION).toBe(500);
  });
});
