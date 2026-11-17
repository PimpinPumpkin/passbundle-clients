// Keykeeper: selecting several items in the extension's popup (DESIGN.md,
// "Selecting several items"). The steps of selecting, as arithmetic on lists
// of item ids in the order the list shows them, so they are tested on their
// own. The popup's Select mode keeps its state in
// KeykeeperPopupSelectionService (popup-selection.service.ts), which uses
// these, and lets go of rows that leave the list with stillListed.
import { MAX_SELECTION, rangeBetween } from "@bitwarden/vault";

/** What a step leaves selected, in the order it was selected, and whether the limit cut it short. */
export type SelectionStep = { ids: string[]; limited: boolean };

/**
 * A row's checkbox was clicked. Without Shift, or with no earlier click to
 * start from, it toggles that row. With Shift, every row from the one clicked
 * before (`anchor`) to this one takes this row's new state, as in the web
 * vault. `order` is the rows that can be selected, as the list shows them.
 */
export function clickRow(
  selected: readonly string[],
  order: readonly string[],
  id: string,
  anchor: string | undefined,
  shift: boolean,
  max = MAX_SELECTION,
): SelectionStep {
  const wasSelected = selected.includes(id);

  if (!shift || anchor == null) {
    if (wasSelected) {
      return { ids: selected.filter((row) => row !== id), limited: false };
    }
    if (selected.length >= max) {
      return { ids: [...selected], limited: true };
    }
    return { ids: [...selected, id], limited: false };
  }

  const range = rangeBetween(order, anchor, id);
  if (wasSelected) {
    const dropped = new Set([id, ...range]);
    return { ids: selected.filter((row) => !dropped.has(row)), limited: false };
  }

  // The clicked row first, so it is in even when the limit cuts the range.
  const fresh = [id, ...range.filter((row) => row !== id)].filter((row) => !selected.includes(row));
  const room = Math.max(0, max - selected.length);
  return { ids: [...selected, ...fresh.slice(0, room)], limited: fresh.length > room };
}

/**
 * "Select all" was clicked: with every row (or as many as the limit allows)
 * already selected, it lets go of them; otherwise it selects every row shown,
 * top to bottom, up to the limit.
 */
export function clickAll(
  selected: readonly string[],
  order: readonly string[],
  max = MAX_SELECTION,
): SelectionStep {
  if (allSelected(selected, order, max)) {
    return { ids: [], limited: false };
  }
  return { ids: order.slice(0, max), limited: order.length > max };
}

/**
 * Whether "Select all" shows as checked: something is shown and every row is
 * selected, or as many as the limit allows.
 */
export function allSelected(
  selected: readonly string[],
  order: readonly string[],
  max = MAX_SELECTION,
): boolean {
  if (order.length === 0) {
    return false;
  }
  const chosen = new Set(selected);
  const shown = order.filter((row) => chosen.has(row)).length;
  return shown === order.length || shown >= max;
}
