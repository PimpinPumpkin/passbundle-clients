// Keykeeper: the parts of selecting several items at once that are plain
// arithmetic on lists (DESIGN.md, "Selecting several items"). Nothing here
// decides what a person may do: the lists that use it ask the rules the
// single item's own menu already goes by, and hand the answers in.

/** The most a selection takes in one go, as "Select all" already had it. */
export const MAX_SELECTION = 500;

/**
 * The rows from one to the other, both included, in the order the list shows
 * them. Shift+click selects these. Only `to` when either row is no longer in
 * the list (it was filtered away, or the list changed under the anchor).
 */
export function rangeBetween<T>(
  order: readonly T[],
  from: T,
  to: T,
  same: (a: T, b: T) => boolean = Object.is,
): T[] {
  const start = order.findIndex((row) => same(row, from));
  const end = order.findIndex((row) => same(row, to));
  if (start < 0 || end < 0) {
    return [to];
  }
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/**
 * What stays selected when the list is read again: the rows that are still in
 * it, as the list has them now, in the order they were selected. A row that
 * left the list is let go of, so nothing is done to an item nobody can see.
 */
export function stillListed<T>(
  selected: readonly T[],
  listed: readonly T[],
  key: (row: T) => string,
): T[] {
  const now = new Map(listed.map((row) => [key(row), row]));
  return selected.flatMap((row) => {
    const current = now.get(key(row));
    return current === undefined ? [] : [current];
  });
}

/** What an action will be done to, and what it leaves alone. */
export type BulkPlan<T> = { allowed: T[]; skipped: T[] };

/**
 * Splits a selection by an answer per item: `allowed[i]` says whether the
 * action may be done to `items[i]`. An item with no answer is skipped.
 */
export function splitByAllowed<T>(items: readonly T[], allowed: readonly boolean[]): BulkPlan<T> {
  const plan: BulkPlan<T> = { allowed: [], skipped: [] };
  items.forEach((item, i) => (allowed[i] === true ? plan.allowed : plan.skipped).push(item));
  return plan;
}

/** How a run of one request per item went. */
export type BulkRun<T> = { done: T[]; failed: T[] };

/**
 * Does one thing per item, one after the other, and keeps going when one
 * fails, so the person hears how many went through and how many didn't.
 * `progress` is called before each item with how many are finished.
 */
export async function runEach<T>(
  items: readonly T[],
  act: (item: T) => Promise<void>,
  progress?: (finished: number, total: number) => void,
): Promise<BulkRun<T>> {
  const run: BulkRun<T> = { done: [], failed: [] };
  for (const [i, item] of items.entries()) {
    progress?.(i, items.length);
    try {
      await act(item);
      run.done.push(item);
    } catch {
      run.failed.push(item);
    }
  }
  progress?.(items.length, items.length);
  return run;
}
