import {
  describeFillRule,
  FillRule,
  readFillRules,
} from "@bitwarden/common/vault/keykeeper/fill-rules";

import { visibleCustomFields } from "./reserved-fields";

/** A rule as the item view and editor list it. */
export type ListedFillRule = { rule: FillRule; site: string; text: string };

type ItemWithFields = {
  fields?: { name?: string | null; value?: string | null }[] | null;
};

/**
 * Keykeeper: an item's fill rules in plain language, for the item view and
 * editor. A rule that fills a custom field the item no longer has says so,
 * since it can't fill anything until a field with that name is back.
 */
export function listFillRules(item: ItemWithFields | null | undefined): ListedFillRule[] {
  const names = new Set(visibleCustomFields(item?.fields).map((field) => field.name));
  return readFillRules(item).map((rule) => {
    const { site, text } = describeFillRule(rule);
    const missing = rule.fill.from === "field" && !names.has(rule.fill.name);
    return { rule, site, text: missing ? `${text}, which this item doesn't have` : text };
  });
}
